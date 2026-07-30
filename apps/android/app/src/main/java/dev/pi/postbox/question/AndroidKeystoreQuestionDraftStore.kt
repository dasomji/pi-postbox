package dev.pi.postbox.question

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.UnrecoverableKeyException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * App-private Question draft storage backed by one non-exportable Android Keystore key.
 *
 * Server URLs, request IDs, selected values, and Notes never appear in paths or plaintext files.
 * Only SHA-256 identities are used for directories/files, and each encrypted payload is bound to
 * those identities as AES-GCM associated data.
 */
class AndroidKeystoreQuestionDraftStore private constructor(
    private val rootDirectory: File,
    private val keyAlias: String,
    private val atomicWriter: AndroidAtomicDraftWriter,
    private val ioDispatcher: CoroutineDispatcher
) : QuestionDraftStore {
    constructor(context: Context) : this(
        rootDirectory = defaultRootDirectory(context),
        keyAlias = KEY_ALIAS,
        atomicWriter = AndroidAtomicDraftWriter(),
        ioDispatcher = Dispatchers.IO
    )

    internal constructor(
        rootDirectory: File,
        keyAlias: String,
        atomicWriter: AndroidAtomicDraftWriter = AndroidAtomicDraftWriter()
    ) : this(
        rootDirectory = rootDirectory,
        keyAlias = keyAlias,
        atomicWriter = atomicWriter,
        ioDispatcher = Dispatchers.IO
    )

    override suspend fun load(
        key: QuestionDraftKey
    ): QuestionDraftStoreResult<QuestionAnswerDraft?> = withContext(ioDispatcher) {
        val file = draftFile(key)
        if (!file.exists() && !File(file.path + ATOMIC_BACKUP_SUFFIX).exists()) {
            return@withContext QuestionDraftStoreResult.Success(null)
        }

        try {
            val secretKey = existingSecretKey()
                ?: return@withContext unreadableFailure(
                    file = file,
                    reason = QuestionDraftStoreFailure.KEY_INVALIDATED
                )
            val envelope = AtomicFile(file).openRead().use { input ->
                input.readBytesBounded(MAX_ENVELOPE_BYTES)
            }
            val plaintext = decrypt(key, secretKey, envelope)
            QuestionDraftStoreResult.Success(decodeDraft(plaintext))
        } catch (_: InvalidKeyException) {
            deleteKeyQuietly()
            unreadableFailure(file, QuestionDraftStoreFailure.KEY_INVALIDATED)
        } catch (_: UnrecoverableKeyException) {
            deleteKeyQuietly()
            unreadableFailure(file, QuestionDraftStoreFailure.KEY_INVALIDATED)
        } catch (_: CharacterCodingException) {
            unreadableFailure(file, QuestionDraftStoreFailure.CORRUPT)
        } catch (_: EOFException) {
            unreadableFailure(file, QuestionDraftStoreFailure.CORRUPT)
        } catch (_: GeneralSecurityException) {
            unreadableFailure(file, QuestionDraftStoreFailure.CORRUPT)
        } catch (_: IllegalArgumentException) {
            unreadableFailure(file, QuestionDraftStoreFailure.CORRUPT)
        } catch (_: IOException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.READ_FAILED)
        } catch (_: RuntimeException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.READ_FAILED)
        }
    }

    override suspend fun save(
        key: QuestionDraftKey,
        draft: QuestionAnswerDraft
    ): QuestionDraftStoreResult<Unit> = withContext(ioDispatcher) {
        if (!draft.isWithinIndependentBounds()) {
            return@withContext QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        }

        try {
            val parent = serverDirectory(key.normalizedServerUrl)
            if (!parent.exists() && !parent.mkdirs()) {
                return@withContext QuestionDraftStoreResult.Failure(
                    QuestionDraftStoreFailure.WRITE_FAILED
                )
            }
            val envelope = encrypt(key, getOrCreateSecretKey(), encodeDraft(draft))
            atomicWriter.write(draftFile(key), envelope)
            QuestionDraftStoreResult.Success(Unit)
        } catch (_: InvalidKeyException) {
            deleteKeyQuietly()
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.KEY_INVALIDATED)
        } catch (_: UnrecoverableKeyException) {
            deleteKeyQuietly()
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.KEY_INVALIDATED)
        } catch (_: GeneralSecurityException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        } catch (_: IOException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        } catch (_: RuntimeException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        }
    }

    override suspend fun delete(
        key: QuestionDraftKey
    ): QuestionDraftStoreResult<Unit> = withContext(ioDispatcher) {
        try {
            AtomicFile(draftFile(key)).delete()
            serverDirectory(key.normalizedServerUrl).deleteIfEmpty()
            QuestionDraftStoreResult.Success(Unit)
        } catch (_: RuntimeException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        }
    }

    override suspend fun reconcileServer(
        normalizedServerUrl: String,
        activeRequestIds: Set<String>
    ): QuestionDraftStoreResult<Unit> = withContext(ioDispatcher) {
        val directory = serverDirectory(normalizedServerUrl)
        if (!directory.exists()) return@withContext QuestionDraftStoreResult.Success(Unit)

        try {
            val activeBaseNames = activeRequestIds.mapTo(hashSetOf()) { requestId ->
                requestIdentity(requestId) + FILE_SUFFIX
            }
            directory.listFiles()?.forEach { entry ->
                val baseName = entry.name
                    .removeSuffix(ATOMIC_BACKUP_SUFFIX)
                    .removeSuffix(ATOMIC_NEW_SUFFIX)
                if (baseName !in activeBaseNames) {
                    AtomicFile(File(directory, baseName)).delete()
                    if (entry.exists()) entry.deleteRecursively()
                }
            } ?: return@withContext QuestionDraftStoreResult.Failure(
                QuestionDraftStoreFailure.WRITE_FAILED
            )
            directory.deleteIfEmpty()
            QuestionDraftStoreResult.Success(Unit)
        } catch (_: RuntimeException) {
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
        }
    }

    private fun unreadableFailure(
        file: File,
        reason: QuestionDraftStoreFailure
    ): QuestionDraftStoreResult.Failure {
        runCatching {
            AtomicFile(file).delete()
            file.parentFile?.deleteIfEmpty()
        }
        return QuestionDraftStoreResult.Failure(reason)
    }

    private fun encrypt(key: QuestionDraftKey, secretKey: SecretKey, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        cipher.updateAAD(associatedData(key))
        val nonce = cipher.iv
        check(nonce.size == NONCE_BYTES)
        val ciphertext = cipher.doFinal(plaintext)
        return ByteBuffer.allocate(ENVELOPE_MAGIC.size + nonce.size + ciphertext.size)
            .put(ENVELOPE_MAGIC)
            .put(nonce)
            .put(ciphertext)
            .array()
    }

    private fun decrypt(key: QuestionDraftKey, secretKey: SecretKey, envelope: ByteArray): ByteArray {
        require(envelope.size >= ENVELOPE_MAGIC.size + NONCE_BYTES + GCM_TAG_BYTES)
        require(envelope.copyOfRange(0, ENVELOPE_MAGIC.size).contentEquals(ENVELOPE_MAGIC))
        val nonceStart = ENVELOPE_MAGIC.size
        val nonce = envelope.copyOfRange(nonceStart, nonceStart + NONCE_BYTES)
        val ciphertext = envelope.copyOfRange(nonceStart + NONCE_BYTES, envelope.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(associatedData(key))
        return cipher.doFinal(ciphertext)
    }

    private fun associatedData(key: QuestionDraftKey): ByteArray =
        (serverIdentity(key.normalizedServerUrl) + "/" + requestIdentity(key.requestId))
            .toByteArray(StandardCharsets.US_ASCII)

    private fun draftFile(key: QuestionDraftKey): File = File(
        serverDirectory(key.normalizedServerUrl),
        requestIdentity(key.requestId) + FILE_SUFFIX
    )

    private fun serverDirectory(normalizedServerUrl: String): File =
        File(rootDirectory, serverIdentity(normalizedServerUrl))

    private fun existingSecretKey(): SecretKey? = synchronized(KEYSTORE_LOCK) {
        val keyStore = androidKeyStore()
        if (!keyStore.containsAlias(keyAlias)) return@synchronized null
        val entry = keyStore.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry
        entry?.secretKey
    }

    private fun getOrCreateSecretKey(): SecretKey = synchronized(KEYSTORE_LOCK) {
        existingSecretKey()?.let { return@synchronized it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(AES_KEY_BITS)
                .build()
        )
        generator.generateKey()
    }

    private fun deleteKeyQuietly() {
        runCatching {
            synchronized(KEYSTORE_LOCK) {
                val keyStore = androidKeyStore()
                if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
            }
        }
    }

    private fun androidKeyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    internal companion object {
        fun defaultRootDirectory(context: Context): File =
            File(context.applicationContext.noBackupFilesDir, DIRECTORY_NAME)

        private const val DIRECTORY_NAME = "question_drafts_v1"
        private const val KEY_ALIAS = "dev.pi.postbox.question_drafts_v1"
        private const val FILE_SUFFIX = ".pqd"
        private const val ATOMIC_BACKUP_SUFFIX = ".bak"
        private const val ATOMIC_NEW_SUFFIX = ".new"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val AES_KEY_BITS = 256
        private const val NONCE_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val GCM_TAG_BYTES = GCM_TAG_BITS / 8
        private const val ENVELOPE_MAGIC_BYTES = 4
        private const val MAX_PLAINTEXT_BYTES =
            Int.SIZE_BYTES +
                Int.SIZE_BYTES +
                MAX_QUESTION_DRAFT_SELECTED_VALUES *
                (Int.SIZE_BYTES + MAX_QUESTION_DRAFT_VALUE_CHARS * MAX_UTF8_BYTES_PER_CHAR) +
                Int.SIZE_BYTES + MAX_QUESTION_DRAFT_NOTE_CHARS * MAX_UTF8_BYTES_PER_CHAR
        private const val MAX_ENVELOPE_BYTES =
            ENVELOPE_MAGIC_BYTES + NONCE_BYTES + GCM_TAG_BYTES + MAX_PLAINTEXT_BYTES
        private val ENVELOPE_MAGIC = byteArrayOf('P'.code.toByte(), 'Q'.code.toByte(), 'D'.code.toByte(), 1)
        private val KEYSTORE_LOCK = Any()
    }
}

internal class AndroidAtomicDraftWriter(
    private val beforeCommit: () -> Unit = {}
) {
    @Throws(IOException::class)
    fun write(target: File, bytes: ByteArray) {
        val atomicFile = AtomicFile(target)
        var stream: FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(bytes)
            stream.flush()
            beforeCommit()
            atomicFile.finishWrite(stream)
            stream = null
        } catch (exception: Exception) {
            stream?.let(atomicFile::failWrite)
            throw exception
        }
    }
}

private fun encodeDraft(draft: QuestionAnswerDraft): ByteArray {
    val output = ByteArrayOutputStream()
    DataOutputStream(output).use { data ->
        data.writeInt(PAYLOAD_VERSION)
        data.writeInt(draft.selectedValues.size)
        draft.selectedValues.forEach { value -> data.writeUtf8Bytes(value) }
        data.writeUtf8Bytes(draft.note)
    }
    return output.toByteArray()
}

private fun decodeDraft(bytes: ByteArray): QuestionAnswerDraft {
    DataInputStream(ByteArrayInputStream(bytes)).use { data ->
        require(data.readInt() == PAYLOAD_VERSION)
        val selectionCount = data.readInt()
        require(selectionCount in 0..MAX_QUESTION_DRAFT_SELECTED_VALUES)
        val selectedValues = List(selectionCount) {
            data.readUtf8Bytes(MAX_QUESTION_DRAFT_VALUE_CHARS)
        }
        require(selectedValues.distinct().size == selectedValues.size)
        val note = data.readUtf8Bytes(MAX_QUESTION_DRAFT_NOTE_CHARS)
        require(data.available() == 0)
        return QuestionAnswerDraft(selectedValues = selectedValues, note = note)
    }
}

private fun DataOutputStream.writeUtf8Bytes(value: String) {
    val bytes = value.toByteArray(StandardCharsets.UTF_8)
    writeInt(bytes.size)
    write(bytes)
}

private fun DataInputStream.readUtf8Bytes(maxChars: Int): String {
    val byteCount = readInt()
    require(byteCount in 0..(maxChars * MAX_UTF8_BYTES_PER_CHAR))
    val bytes = ByteArray(byteCount)
    readFully(bytes)
    val value = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
    require(value.length <= maxChars)
    return value
}

private fun QuestionAnswerDraft.isWithinIndependentBounds(): Boolean =
    selectedValues.size <= MAX_QUESTION_DRAFT_SELECTED_VALUES &&
        selectedValues.distinct().size == selectedValues.size &&
        selectedValues.all { it.length <= MAX_QUESTION_DRAFT_VALUE_CHARS } &&
        note.length <= MAX_QUESTION_DRAFT_NOTE_CHARS

private fun InputStream.readBytesBounded(maxBytes: Int): ByteArray {
    val bytes = ByteArray(maxBytes + 1)
    var offset = 0
    while (offset < bytes.size) {
        val count = read(bytes, offset, bytes.size - offset)
        if (count < 0) break
        offset += count
    }
    require(offset <= maxBytes)
    return bytes.copyOf(offset)
}

private fun serverIdentity(normalizedServerUrl: String): String = sha256Hex(normalizedServerUrl)

private fun requestIdentity(requestId: String): String = sha256Hex(requestId)

private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(StandardCharsets.UTF_8))
    .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

private fun File.deleteIfEmpty() {
    if (isDirectory && listFiles()?.isEmpty() == true) delete()
}

private const val PAYLOAD_VERSION = 1
private const val MAX_UTF8_BYTES_PER_CHAR = 4

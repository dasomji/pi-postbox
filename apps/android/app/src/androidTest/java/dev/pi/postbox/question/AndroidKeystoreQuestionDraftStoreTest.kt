package dev.pi.postbox.question

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import dev.pi.postbox.R
import java.io.File
import java.io.IOException
import java.security.KeyStore
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.xmlpull.v1.XmlPullParser

class AndroidKeystoreQuestionDraftStoreTest {
    private lateinit var context: Context
    private lateinit var rootDirectory: File
    private lateinit var keyAlias: String

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        rootDirectory = File(context.noBackupFilesDir, "question_drafts_test_${UUID.randomUUID()}")
        keyAlias = "dev.pi.postbox.question_drafts_test_${UUID.randomUUID()}"
    }

    @After
    fun tearDown() {
        rootDirectory.deleteRecursively()
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
    }

    @Test
    fun productionRootAndBothRuleFormatsExcludeDraftsFromBackupAndTransfer() {
        val productionRoot = AndroidKeystoreQuestionDraftStore.defaultRootDirectory(context)
        assertTrue(
            productionRoot.canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath + File.separator)
        )
        assertEquals("question_drafts_v1", productionRoot.name)
        assertEquals(1, countDraftExclusions(R.xml.backup_rules))
        assertEquals(2, countDraftExclusions(R.xml.data_extraction_rules))
    }

    @Test
    fun encryptedDraftRoundTripsAcrossStoreRecreationWithoutPlaintextIdentityOrContent() = runBlocking {
        val key = QuestionDraftKey("https://postbox.private.example/", "ask-secret-request")
        val draft = QuestionAnswerDraft(
            selectedValues = listOf("private-choice", "other"),
            note = "private note contents"
        )
        val firstStore = store()

        assertEquals(QuestionDraftStoreResult.Success(Unit), firstStore.save(key, draft))
        assertEquals(QuestionDraftStoreResult.Success(draft), store().load(key))

        val files = rootDirectory.walkTopDown().filter { it.isFile }.toList()
        assertEquals(1, files.size)
        val path = files.single().relativeTo(rootDirectory).path
        val ciphertextText = files.single().readBytes().toString(Charsets.ISO_8859_1)
        listOf(
            "postbox.private.example",
            "ask-secret-request",
            "private-choice",
            "private note contents"
        ).forEach { secret ->
            assertFalse(path.contains(secret))
            assertFalse(ciphertextText.contains(secret))
        }
    }

    @Test
    fun tamperedCiphertextReturnsFiniteCorruptFailure() = runBlocking {
        val key = QuestionDraftKey("https://postbox.example/", "ask-tamper")
        val draft = QuestionAnswerDraft(listOf("one"), "tamper check")
        val store = store()
        assertEquals(QuestionDraftStoreResult.Success(Unit), store.save(key, draft))
        val encryptedFile = rootDirectory.walkTopDown().single { it.isFile }
        val tampered = encryptedFile.readBytes().also { bytes ->
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 0x01).toByte()
        }
        encryptedFile.writeBytes(tampered)

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.CORRUPT),
            store.load(key)
        )
        assertEquals(QuestionDraftStoreResult.Success(null), store.load(key))
    }

    @Test
    fun oversizedCiphertextReturnsFiniteCorruptFailureAndIsDiscarded() = runBlocking {
        val key = QuestionDraftKey("https://postbox.example/", "ask-oversized")
        val store = store()
        assertEquals(
            QuestionDraftStoreResult.Success(Unit),
            store.save(key, QuestionAnswerDraft(listOf("one"), "bounded"))
        )
        rootDirectory.walkTopDown().single { it.isFile }
            .writeBytes(ByteArray(600_000))

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.CORRUPT),
            store.load(key)
        )
        assertEquals(QuestionDraftStoreResult.Success(null), store.load(key))
    }

    @Test
    fun ciphertextSwappedBetweenDraftKeysFailsAuthenticationAndIsDiscarded() = runBlocking {
        val firstKey = QuestionDraftKey("https://first.example/", "ask-shared")
        val secondKey = QuestionDraftKey("https://second.example/", "ask-shared")
        val firstDraft = QuestionAnswerDraft(listOf("one"), "first")
        val secondDraft = QuestionAnswerDraft(listOf("other"), "second")
        val store = store()
        assertEquals(QuestionDraftStoreResult.Success(Unit), store.save(firstKey, firstDraft))
        val firstFile = rootDirectory.walkTopDown().single { it.isFile }
        assertEquals(QuestionDraftStoreResult.Success(Unit), store.save(secondKey, secondDraft))
        val secondFile = rootDirectory.walkTopDown()
            .filter { it.isFile && it != firstFile }
            .single()
        secondFile.writeBytes(firstFile.readBytes())

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.CORRUPT),
            store.load(secondKey)
        )
        assertEquals(QuestionDraftStoreResult.Success(null), store.load(secondKey))
        assertEquals(QuestionDraftStoreResult.Success(firstDraft), store.load(firstKey))
    }

    @Test
    fun outOfBoundsDraftReturnsFiniteWriteFailureWithoutCreatingAFile() = runBlocking {
        val key = QuestionDraftKey("https://postbox.example/", "ask-too-large")
        val draft = QuestionAnswerDraft(
            selectedValues = List(MAX_QUESTION_DRAFT_SELECTED_VALUES + 1) { index -> "value-$index" },
            note = "still in memory"
        )
        val store = store()

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED),
            store.save(key, draft)
        )
        assertFalse(rootDirectory.walkTopDown().any { it.isFile })
    }

    @Test
    fun missingKeyReturnsFiniteFailureAndRetrySaveRecovers() = runBlocking {
        val key = QuestionDraftKey("https://postbox.example/", "ask-key-loss")
        val original = QuestionAnswerDraft(listOf("one"), "before key loss")
        val recovered = QuestionAnswerDraft(listOf("other"), "after key loss")
        val store = store()
        assertEquals(QuestionDraftStoreResult.Success(Unit), store.save(key, original))
        KeyStore.getInstance("AndroidKeyStore").apply {
            load(null)
            deleteEntry(keyAlias)
        }

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.KEY_INVALIDATED),
            store().load(key)
        )
        assertEquals(QuestionDraftStoreResult.Success(null), store().load(key))
        assertEquals(QuestionDraftStoreResult.Success(Unit), store().save(key, recovered))
        assertEquals(QuestionDraftStoreResult.Success(recovered), store().load(key))
    }

    @Test
    fun failedAtomicCommitPreservesOldDraftAndLaterSaveRecovers() = runBlocking {
        val key = QuestionDraftKey("https://postbox.example/", "ask-atomic")
        val oldDraft = QuestionAnswerDraft(listOf("one"), "old draft")
        val newDraft = QuestionAnswerDraft(listOf("other"), "new draft")
        assertEquals(QuestionDraftStoreResult.Success(Unit), store().save(key, oldDraft))
        val failingStore = AndroidKeystoreQuestionDraftStore(
            rootDirectory = rootDirectory,
            keyAlias = keyAlias,
            atomicWriter = AndroidAtomicDraftWriter {
                throw IOException("simulated commit failure")
            }
        )

        assertEquals(
            QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED),
            failingStore.save(key, newDraft)
        )
        assertEquals(QuestionDraftStoreResult.Success(oldDraft), store().load(key))
        assertEquals(QuestionDraftStoreResult.Success(Unit), store().save(key, newDraft))
        assertEquals(QuestionDraftStoreResult.Success(newDraft), store().load(key))
    }

    @Test
    fun deleteAndServerReconciliationRemoveOnlyTargetedDrafts() = runBlocking {
        val server = "https://postbox.example/"
        val keep = QuestionDraftKey(server, "ask-keep")
        val remove = QuestionDraftKey(server, "ask-remove")
        val otherServer = QuestionDraftKey("https://other.example/", "ask-remove")
        val draft = QuestionAnswerDraft(listOf("other"), "draft")
        val store = store()
        listOf(keep, remove, otherServer).forEach { key ->
            assertEquals(QuestionDraftStoreResult.Success(Unit), store.save(key, draft))
        }

        assertEquals(
            QuestionDraftStoreResult.Success(Unit),
            store.reconcileServer(server, setOf(keep.requestId))
        )
        assertEquals(QuestionDraftStoreResult.Success(draft), store.load(keep))
        assertEquals(QuestionDraftStoreResult.Success(null), store.load(remove))
        assertEquals(QuestionDraftStoreResult.Success(draft), store.load(otherServer))

        assertEquals(QuestionDraftStoreResult.Success(Unit), store.delete(keep))
        assertEquals(QuestionDraftStoreResult.Success(null), store.load(keep))
        assertTrue(rootDirectory.exists())
        assertNull(rootDirectory.listFiles()?.firstOrNull { it.name.contains("ask-keep") })
    }

    private fun countDraftExclusions(resourceId: Int): Int {
        val parser = context.resources.getXml(resourceId)
        var count = 0
        while (parser.eventType != XmlPullParser.END_DOCUMENT) {
            if (
                parser.eventType == XmlPullParser.START_TAG &&
                parser.name == "exclude" &&
                parser.getAttributeValue(null, "domain") == "root" &&
                parser.getAttributeValue(null, "path") == "no_backup/question_drafts_v1"
            ) {
                count += 1
            }
            parser.next()
        }
        parser.close()
        return count
    }

    private fun store() = AndroidKeystoreQuestionDraftStore(
        rootDirectory = rootDirectory,
        keyAlias = keyAlias
    )
}

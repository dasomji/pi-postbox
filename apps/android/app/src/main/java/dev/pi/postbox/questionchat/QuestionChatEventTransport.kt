package dev.pi.postbox.questionchat

import dev.pi.postbox.protocol.toPostboxBaseUrl
import dev.pi.postbox.protocol.withPathSegments
import dev.pi.postbox.protocol.POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER
import dev.pi.postbox.protocol.POSTBOX_PROTOCOL_VERSION_HEADER
import dev.pi.postbox.protocol.PostboxProtocolMismatchException
import dev.pi.postbox.protocol.ProtocolCompatibilityGate
import dev.pi.postbox.protocol.ProtocolMessageSource
import java.io.Closeable
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.BufferedSource

interface QuestionChatEventConnection : Closeable {
    val ready: CompletableDeferred<Unit>
    suspend fun join()
}

interface QuestionChatEventTransport {
    fun open(requestId: String, onFact: (QuestionChatEventTransportFact) -> Unit): QuestionChatEventConnection
}

class OkHttpQuestionChatEventTransport(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultQuestionChatEventHttpClient(),
    private val compatibilityGate: ProtocolCompatibilityGate = ProtocolCompatibilityGate()
) : QuestionChatEventTransport {
    private val base: HttpUrl = baseUrl.toPostboxBaseUrl()

    override fun open(
        requestId: String,
        onFact: (QuestionChatEventTransportFact) -> Unit
    ): QuestionChatEventConnection {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val ready = CompletableDeferred<Unit>()
        val request = Request.Builder()
            .url(base.withPathSegments(listOf("api", "requests", requestId, "chat", "events")))
            .header("Accept", "text/event-stream")
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, compatibilityGate.supportedVersion)
            .get()
            .build()
        val call = httpClient.newCall(request)
        val job = scope.launch {
            try {
                call.execute().use { response ->
                    compatibilityGate.requireCompatibleHttpResponse(
                        statusCode = response.code,
                        rawMessage = "",
                        responseProtocolVersion = response.header(POSTBOX_PROTOCOL_VERSION_HEADER),
                        source = ProtocolMessageSource.QUESTION_CHAT_STREAM
                    )
                    if (!response.isSuccessful) {
                        throw QuestionChatTransportException("Question Chat event stream failed with HTTP ${response.code}")
                    }
                    ready.complete(Unit)
                    onFact(QuestionChatEventTransportFact.Open)
                    val body = response.body ?: throw QuestionChatTransportException("Missing Question Chat event stream body")
                    val parser = QuestionChatSseParser(body.source())
                    var incompatible = false
                    while (true) {
                        val payload = try {
                            parser.readNextEventData()
                        } catch (error: QuestionChatTransportException) {
                            onFact(QuestionChatEventTransportFact.Stale(error))
                            break
                        } ?: break
                        try {
                            val event = compatibilityGate.decodeVersioned(payload, ProtocolMessageSource.QUESTION_CHAT_STREAM) {
                                parseQuestionChatStreamEvent(parseJsonObject(it))
                            }
                            if (event.requestId != requestId) {
                                onFact(
                                    QuestionChatEventTransportFact.Stale(
                                        QuestionChatTransportException("Wrong Question Chat request id in SSE frame")
                                    )
                                )
                                continue
                            }
                            onFact(QuestionChatEventTransportFact.Event(event))
                        } catch (error: PostboxProtocolMismatchException) {
                            onFact(QuestionChatEventTransportFact.IncompatibleProtocol(error.mismatch))
                            incompatible = true
                            break
                        } catch (error: QuestionChatTransportException) {
                            onFact(QuestionChatEventTransportFact.Stale(error))
                        }
                    }
                    if (!incompatible) onFact(QuestionChatEventTransportFact.EndOfStream)
                }
            } catch (error: PostboxProtocolMismatchException) {
                if (!ready.isCompleted) ready.completeExceptionally(error)
                onFact(QuestionChatEventTransportFact.IncompatibleProtocol(error.mismatch))
            } catch (error: Throwable) {
                if (!ready.isCompleted) ready.completeExceptionally(error)
                onFact(QuestionChatEventTransportFact.Failure(error))
            }
        }
        return object : QuestionChatEventConnection {
            override val ready: CompletableDeferred<Unit> = ready

            override fun close() {
                call.cancel()
                scope.cancel()
            }

            override suspend fun join() {
                job.join()
            }
        }
    }
}

fun defaultQuestionChatEventHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS)
    .callTimeout(0, TimeUnit.SECONDS)
    .build()

private class QuestionChatSseParser(
    private val source: BufferedSource
) {
    private val utf8Decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)

    fun readNextEventData(): String? {
        var eventName: String? = null
        val dataLines = mutableListOf<String>()
        var fieldCount = 0
        var dataBytes = 0
        while (true) {
            val line = readLine() ?: return null
            if (line.isEmpty()) {
                if (dataLines.isEmpty()) {
                    eventName = null
                    fieldCount = 0
                    dataBytes = 0
                    continue
                }
                return dataLines.joinToString("\n")
            }
            fieldCount += 1
            if (fieldCount > QuestionChatTransportLimits.SSE_FIELD_COUNT_MAX) {
                throw QuestionChatTransportException("Question Chat SSE event exceeded field limit")
            }
            if (line.startsWith(":")) continue
            val separator = line.indexOf(':')
            val field = if (separator >= 0) line.substring(0, separator) else line
            var value = if (separator >= 0) line.substring(separator + 1) else ""
            if (value.startsWith(" ")) value = value.removePrefix(" ")
            when (field) {
                "event" -> eventName = value
                "data" -> {
                    if (eventName == null || eventName == "ignored" || eventName == "message") {
                        dataLines += value
                        if (dataLines.size > QuestionChatTransportLimits.SSE_DATA_LINE_COUNT_MAX) {
                            throw QuestionChatTransportException("Question Chat SSE event exceeded data line limit")
                        }
                        dataBytes += value.encodeToByteArray().size
                        if (dataBytes > QuestionChatTransportLimits.SSE_EVENT_DATA_MAX_BYTES) {
                            throw QuestionChatTransportException("Question Chat SSE event exceeded data limit")
                        }
                    }
                }
                else -> Unit
            }
        }
    }

    private fun readLine(): String? {
        if (source.exhausted()) return null
        val buffer = okio.Buffer()
        var bytes = 0
        while (true) {
            if (source.exhausted()) return decodeUtf8Line(buffer.readByteArray())
            val byte = source.readByte().toInt()
            bytes += 1
            if (bytes > QuestionChatTransportLimits.SSE_LINE_MAX_BYTES) {
                throw QuestionChatTransportException("Question Chat SSE line exceeded limit")
            }
            when (byte) {
                '\n'.code -> return decodeUtf8Line(buffer.readByteArray())
                '\r'.code -> {
                    if (!source.exhausted() && source.request(1) && source.buffer[0] == '\n'.code.toByte()) {
                        source.readByte()
                    }
                    return decodeUtf8Line(buffer.readByteArray())
                }
                else -> buffer.writeByte(byte)
            }
        }
    }

    private fun decodeUtf8Line(bytes: ByteArray): String = try {
        utf8Decoder.reset()
        utf8Decoder.decode(ByteBuffer.wrap(bytes)).toString()
    } catch (error: CharacterCodingException) {
        throw QuestionChatTransportException("Malformed UTF-8 in Question Chat SSE line", error)
    }
}

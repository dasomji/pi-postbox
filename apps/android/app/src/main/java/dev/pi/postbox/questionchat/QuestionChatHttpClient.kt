package dev.pi.postbox.questionchat

import dev.pi.postbox.protocol.JSON_MEDIA_TYPE
import dev.pi.postbox.protocol.toPostboxBaseUrl
import dev.pi.postbox.protocol.withPathSegments
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer

private val questionChatJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

interface QuestionChatHttpClient {
    suspend fun activateExact(requestId: String): QuestionChatActivationResult
    suspend fun activateContext(requestId: String): QuestionChatActivationResult
    suspend fun probeSnapshot(requestId: String): QuestionChatProbeResult
    suspend fun fetchSnapshot(requestId: String): QuestionChatSnapshotResult
    suspend fun sendMessage(requestId: String, clientCommandId: String, message: String): QuestionChatCommandResult<QuestionChatSendResponse>
    suspend fun stop(requestId: String, clientCommandId: String): QuestionChatCommandResult<QuestionChatStopResponse>
}

class OkHttpQuestionChatHttpClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultQuestionChatHttpClient()
) : QuestionChatHttpClient {
    private val base: HttpUrl = baseUrl.toPostboxBaseUrl()

    override suspend fun activateExact(requestId: String): QuestionChatActivationResult =
        withJsonResponse(
            request = Request.Builder()
                .url(base.withPathSegments(listOf("api", "requests", requestId, "chat")))
                .post(ByteArray(0).toRequestBody(null))
                .build(),
            maxBytes = QuestionChatTransportLimits.SNAPSHOT_JSON_BODY_MAX_BYTES
        ) { _, body -> parseActivationResponse(body) }

    override suspend fun activateContext(requestId: String): QuestionChatActivationResult =
        withJsonResponse(
            request = Request.Builder()
                .url(base.withPathSegments(listOf("api", "requests", requestId, "chat", "context")))
                .post("{\"confirmed\":true}".toRequestBody(JSON_MEDIA_TYPE))
                .build(),
            maxBytes = QuestionChatTransportLimits.SNAPSHOT_JSON_BODY_MAX_BYTES
        ) { _, body -> parseActivationResponse(body) }

    override suspend fun probeSnapshot(requestId: String): QuestionChatProbeResult =
        withJsonResponse(
            request = Request.Builder()
                .url(base.withPathSegments(listOf("api", "requests", requestId, "chat")))
                .get()
                .build(),
            maxBytes = QuestionChatTransportLimits.SNAPSHOT_JSON_BODY_MAX_BYTES
        ) { _, body ->
            val parsed = parseSnapshotEnvelope(body)
            when (parsed) {
                is SnapshotEnvelope.Ready -> QuestionChatProbeResult.Ready(parsed.snapshot)
                is SnapshotEnvelope.Unavailable -> {
                    if (parsed.error.code == QuestionChatAvailabilityCode.CHAT_NOT_STARTED) {
                        QuestionChatProbeResult.NotStarted
                    } else {
                        QuestionChatProbeResult.Unavailable(parsed.error)
                    }
                }
            }
        }

    override suspend fun fetchSnapshot(requestId: String): QuestionChatSnapshotResult =
        withJsonResponse(
            request = Request.Builder()
                .url(base.withPathSegments(listOf("api", "requests", requestId, "chat")))
                .get()
                .build(),
            maxBytes = QuestionChatTransportLimits.SNAPSHOT_JSON_BODY_MAX_BYTES
        ) { _, body ->
            when (val parsed = parseSnapshotEnvelope(body)) {
                is SnapshotEnvelope.Ready -> QuestionChatSnapshotResult.Ready(parsed.snapshot)
                is SnapshotEnvelope.Unavailable -> QuestionChatSnapshotResult.Unavailable(parsed.error)
            }
        }

    override suspend fun sendMessage(
        requestId: String,
        clientCommandId: String,
        message: String
    ): QuestionChatCommandResult<QuestionChatSendResponse> = withJsonResponse(
        request = Request.Builder()
            .url(base.withPathSegments(listOf("api", "requests", requestId, "chat", "messages")))
            .post(
                "{\"clientCommandId\":${JsonPrimitive(clientCommandId)},\"message\":${JsonPrimitive(message)}}"
                    .toRequestBody(JSON_MEDIA_TYPE)
            )
            .build(),
        maxBytes = QuestionChatTransportLimits.SMALL_JSON_BODY_MAX_BYTES
    ) { _, body -> parseSendResponse(body) }

    override suspend fun stop(requestId: String, clientCommandId: String): QuestionChatCommandResult<QuestionChatStopResponse> = withJsonResponse(
        request = Request.Builder()
            .url(base.withPathSegments(listOf("api", "requests", requestId, "chat", "stop")))
            .post("{\"clientCommandId\":${JsonPrimitive(clientCommandId)}}".toRequestBody(JSON_MEDIA_TYPE))
            .build(),
        maxBytes = QuestionChatTransportLimits.SMALL_JSON_BODY_MAX_BYTES
    ) { _, body -> parseStopResponse(body) }

    private suspend fun <T> withJsonResponse(
        request: Request,
        maxBytes: Int,
        transform: (Int, JsonObject) -> T
    ): T = withContext(Dispatchers.IO) {
        execute(request).use { response ->
            val body = response.body ?: throw QuestionChatTransportException("Missing Question Chat response body")
            val decoded = parseJsonObject(body.readUtf8Bounded(maxBytes))
            transform(response.code, decoded)
        }
    }

    private suspend fun execute(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = httpClient.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (!continuation.isCancelled) continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                if (continuation.isCancelled) {
                    response.close()
                } else {
                    continuation.resume(response)
                }
            }
        })
    }
}

fun defaultQuestionChatHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .readTimeout(70, TimeUnit.SECONDS)
    .callTimeout(70, TimeUnit.SECONDS)
    .build()

private sealed interface SnapshotEnvelope {
    data class Ready(val snapshot: QuestionChatSnapshot) : SnapshotEnvelope
    data class Unavailable(val error: QuestionChatAvailabilityError) : SnapshotEnvelope
}

private fun parseActivationResponse(body: JsonObject): QuestionChatActivationResult = when (body.requiredString("status")) {
    "ready" -> QuestionChatActivationResult.Ready(parseSnapshot(body.requiredObject("snapshot")))
    "unavailable" -> QuestionChatActivationResult.Unavailable(parseAvailabilityError(body.requiredObject("error")))
    else -> throw QuestionChatTransportException("Unknown activation status")
}

private fun parseSnapshotEnvelope(body: JsonObject): SnapshotEnvelope = when (body.requiredString("status")) {
    "ready" -> SnapshotEnvelope.Ready(parseSnapshot(body.requiredObject("snapshot")))
    "unavailable" -> SnapshotEnvelope.Unavailable(parseAvailabilityError(body.requiredObject("error")))
    else -> throw QuestionChatTransportException("Unknown snapshot status")
}

private fun parseSendResponse(body: JsonObject): QuestionChatCommandResult<QuestionChatSendResponse> {
    return when (body.requiredString("status")) {
        "accepted" -> QuestionChatCommandResult.Accepted(
            QuestionChatSendResponse(
                clientCommandId = body.requiredString("clientCommandId"),
                mode = body["mode"]?.jsonPrimitive?.contentOrNull?.let(QuestionChatSendMode::fromWire)
            )
        )
        "unavailable" -> QuestionChatCommandResult.Unavailable(parseAvailabilityError(body.requiredObject("error")))
        else -> throw QuestionChatTransportException("Unknown send status")
    }
}

private fun parseStopResponse(body: JsonObject): QuestionChatCommandResult<QuestionChatStopResponse> {
    return when (body.requiredString("status")) {
        "accepted" -> QuestionChatCommandResult.Accepted(
            QuestionChatStopResponse(clientCommandId = body.requiredString("clientCommandId"))
        )
        "unavailable" -> QuestionChatCommandResult.Unavailable(parseAvailabilityError(body.requiredObject("error")))
        else -> throw QuestionChatTransportException("Unknown stop status")
    }
}

internal fun parseQuestionChatStreamEvent(body: JsonObject): QuestionChatStreamEvent {
    if (body.requiredString("type") == "transport") {
        return QuestionChatStreamEvent.Transport(
            requestId = body.requiredString("requestId"),
            online = body.requiredString("state") == "online"
        )
    }
    return QuestionChatStreamEvent.Event(
        requestId = body.requiredString("requestId"),
        payload = parseQuestionChatEvent(body)
    )
}

private fun parseQuestionChatEvent(body: JsonObject): QuestionChatEvent {
    val requestId = body.requiredString("requestId")
    val sequence = body.requiredInt("sequence")
    return when (body.requiredString("type")) {
        "lifecycle" -> QuestionChatEvent.Lifecycle(requestId, sequence, QuestionChatState.fromWire(body.requiredString("state")))
        "message.started" -> QuestionChatEvent.MessageStarted(requestId, sequence, parseMessage(body.requiredObject("message")))
        "assistant.text.delta" -> QuestionChatEvent.AssistantTextDelta(requestId, sequence, body.requiredString("messageId"), body.requiredString("text"))
        "message.finished" -> QuestionChatEvent.MessageFinished(
            requestId = requestId,
            sequence = sequence,
            messageId = body.requiredString("messageId"),
            text = body.requiredString("text"),
            status = body["status"]?.jsonPrimitive?.contentOrNull?.let(QuestionChatMessage.Assistant.Status::fromWire)
                ?: QuestionChatMessage.Assistant.Status.FINAL
        )
        "tool.started" -> QuestionChatEvent.ToolStarted(requestId, sequence, parseToolActivity(body.requiredObject("activity")))
        "tool.finished" -> QuestionChatEvent.ToolFinished(requestId, sequence, parseToolActivity(body.requiredObject("activity")))
        else -> throw QuestionChatTransportException("Unknown Question Chat event type")
    }
}

private fun parseSnapshot(body: JsonObject): QuestionChatSnapshot = QuestionChatSnapshot(
    requestId = body.requiredString("requestId"),
    state = QuestionChatState.fromWire(body.requiredString("state")),
    forkKind = QuestionChatForkKind.fromWire(body.requiredString("forkKind")),
    model = parseModel(body.requiredObject("model")),
    sequence = body.requiredInt("sequence"),
    messages = body.requiredArray("messages").map { parseMessage(it.jsonObject) },
    tools = (body["tools"] as? JsonArray).orEmpty().map { parseToolActivity(it.jsonObject) }
)

private fun parseModel(body: JsonObject): QuestionChatModel = QuestionChatModel(
    id = body.requiredString("id"),
    source = QuestionChatModelSource.fromWire(body.requiredString("source")),
    fallbackReason = body["fallbackReason"]?.jsonPrimitive?.contentOrNull
)

private fun parseAvailabilityError(body: JsonObject): QuestionChatAvailabilityError = QuestionChatAvailabilityError(
    code = QuestionChatAvailabilityCode.fromWire(body.requiredString("code")),
    message = body.requiredString("message"),
    retryAfterMs = body["retryAfterMs"]?.jsonPrimitive?.contentOrNull?.toLongOrNull(),
    contextFallback = body["contextFallback"]?.jsonObject?.let(::parseContextFallback)
)

private fun parseContextFallback(body: JsonObject): QuestionChatContextFallbackAvailability = when (body.requiredString("status")) {
    "available" -> QuestionChatContextFallbackAvailability.Available
    "unavailable" -> QuestionChatContextFallbackAvailability.Unavailable(body.requiredString("reason"))
    else -> throw QuestionChatTransportException("Unknown context fallback status")
}

private fun parseMessage(body: JsonObject): QuestionChatMessage = when (body.requiredString("role")) {
    "user" -> QuestionChatMessage.User(
        id = body.requiredString("id"),
        text = body.requiredString("text")
    )
    "assistant" -> QuestionChatMessage.Assistant(
        id = body.requiredString("id"),
        text = body.requiredString("text"),
        status = QuestionChatMessage.Assistant.Status.fromWire(body.requiredString("status"))
    )
    else -> throw QuestionChatTransportException("Unknown Question Chat role")
}

private fun parseToolActivity(body: JsonObject): QuestionChatToolActivity = QuestionChatToolActivity(
    id = body.requiredString("id"),
    tool = body.requiredString("tool"),
    target = body.requiredString("target"),
    state = body.requiredString("state"),
    details = body["details"]?.jsonPrimitive?.contentOrNull,
    actionOptionValue = body["action"]?.jsonObject?.get("optionValue")?.jsonPrimitive?.contentOrNull
)

internal fun parseJsonObject(value: String): JsonObject = try {
    questionChatJson.parseToJsonElement(value).jsonObject
} catch (error: Exception) {
    throw QuestionChatTransportException("Malformed Question Chat JSON", error)
}

private fun okhttp3.ResponseBody.readUtf8Bounded(maxBytes: Int): String {
    val buffer = ByteArray(8192)
    val out = Buffer()
    var total = 0
    val input = byteStream()
    while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        total += read
        if (total > maxBytes) throw QuestionChatTransportException("Question Chat response body is too large.")
        out.write(buffer, 0, read)
    }
    return out.readUtf8()
}

private fun JsonObject.requiredString(name: String): String = this[name]?.jsonPrimitive?.contentOrNull
    ?: throw QuestionChatTransportException("Missing Question Chat field: $name")

private fun JsonObject.requiredInt(name: String): Int = this[name]?.jsonPrimitive?.intOrNull
    ?: throw QuestionChatTransportException("Missing Question Chat integer field: $name")

private fun JsonObject.requiredObject(name: String): JsonObject = this[name]?.jsonObject
    ?: throw QuestionChatTransportException("Missing Question Chat object field: $name")

private fun JsonObject.requiredArray(name: String): JsonArray = this[name]?.jsonArray
    ?: throw QuestionChatTransportException("Missing Question Chat array field: $name")

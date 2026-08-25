package dev.pi.postbox.protocol

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface PostboxProtocolClient {
    suspend fun fetchHealth(): HealthResponse
    suspend fun fetchState(): StateSnapshot
    suspend fun answerRequest(requestId: String, payload: AskAnswerPayload)
    suspend fun cancelRequest(requestId: String, payload: AskCancelPayload)
}

class OkHttpPostboxProtocolClient(
    baseUrl: String,
    private val client: OkHttpClient = defaultProtocolHttpClient(),
    private val compatibilityGate: ProtocolCompatibilityGate = ProtocolCompatibilityGate()
) : PostboxProtocolClient {
    private val base: HttpUrl = baseUrl.toPostboxBaseUrl()

    override suspend fun fetchHealth(): HealthResponse = getJson(pathSegments = listOf("healthz"), source = ProtocolMessageSource.HEALTH) { body ->
        PostboxProtocolJson.json.decodeFromJsonElement(HealthResponse.serializer(), body)
    }

    override suspend fun fetchState(): StateSnapshot = getJson(pathSegments = listOf("api", "state"), source = ProtocolMessageSource.STATE_HTTP) { body ->
        PostboxProtocolJson.decodeStateSnapshot(body)
    }

    override suspend fun answerRequest(requestId: String, payload: AskAnswerPayload) {
        postJson(
            pathSegments = listOf("api", "requests", requestId, "answer"),
            body = PostboxProtocolJson.encodeAnswerPayload(payload),
            requestId = requestId
        )
    }

    override suspend fun cancelRequest(requestId: String, payload: AskCancelPayload) {
        postJson(
            pathSegments = listOf("api", "requests", requestId, "cancel"),
            body = PostboxProtocolJson.encodeCancelPayload(payload),
            requestId = requestId
        )
    }

    private suspend fun <T> getJson(pathSegments: List<String>, source: ProtocolMessageSource, decode: (JsonObject) -> T): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(base.withPathSegments(pathSegments))
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, compatibilityGate.supportedVersion)
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            val decodedBody = compatibilityGate.decodeHttpResponse(
                rawMessage = body,
                statusCode = response.code,
                responseProtocolVersion = response.header(POSTBOX_PROTOCOL_VERSION_HEADER),
                source = source
            ) { it }
            if (!response.isSuccessful) {
                throw PostboxProtocolHttpException(response.code, body)
            }
            decode(decodedBody)
        }
    }

    private suspend fun postJson(pathSegments: List<String>, body: String, requestId: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(base.withPathSegments(pathSegments))
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, compatibilityGate.supportedVersion)
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            val decodedBody = compatibilityGate.decodeHttpResponse(
                rawMessage = responseBody,
                statusCode = response.code,
                responseProtocolVersion = response.header(POSTBOX_PROTOCOL_VERSION_HEADER),
                source = ProtocolMessageSource.STATE_HTTP
            ) { it }
            if (response.code == 409) {
                val error = PostboxErrorResponse.parse(decodedBody)
                if (error?.error == "stale_revision" || error?.code == "stale_revision") {
                    throw PostboxStaleRevisionException(
                        requestId = requestId,
                        serverMessage = error.message
                    )
                }
                throw PostboxRequestAlreadyResolvedException(
                    requestId = requestId,
                    serverCode = error?.error ?: error?.code,
                    serverMessage = error?.message
                )
            }
            if (!response.isSuccessful) {
                throw PostboxProtocolHttpException(response.code, responseBody)
            }
        }
    }
}

class PostboxStaleRevisionException(
    val requestId: String,
    val serverMessage: String? = null
) : IOException(serverMessage ?: "Question $requestId was updated")

class PostboxRequestAlreadyResolvedException(
    val requestId: String,
    val serverCode: String?,
    val serverMessage: String? = null
) : IOException("Request $requestId is already resolved${serverCode?.let { " ($it)" }.orEmpty()}")

class PostboxProtocolHttpException(
    val statusCode: Int,
    val responseBody: String
) : IOException("Postbox request failed with HTTP $statusCode")

internal val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

internal fun String.toPostboxBaseUrl(): HttpUrl = toHttpUrlOrNull()
    ?.newBuilder()
    ?.encodedPath("/")
    ?.query(null)
    ?.fragment(null)
    ?.build()
    ?: throw IllegalArgumentException("Invalid Postbox base URL: $this")

internal fun HttpUrl.withPathSegments(pathSegments: List<String>): HttpUrl {
    val builder = newBuilder()
        .encodedPath("/")
        .query(null)
        .fragment(null)
    pathSegments.forEach { builder.addPathSegment(it) }
    return builder.build()
}

internal fun defaultProtocolHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .callTimeout(0, TimeUnit.SECONDS)
    .build()

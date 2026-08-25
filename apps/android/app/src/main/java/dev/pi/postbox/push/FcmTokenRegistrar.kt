package dev.pi.postbox.push

import dev.pi.postbox.protocol.JSON_MEDIA_TYPE
import dev.pi.postbox.protocol.PostboxProtocolHttpException
import dev.pi.postbox.protocol.defaultProtocolHttpClient
import dev.pi.postbox.protocol.toPostboxBaseUrl
import dev.pi.postbox.protocol.withPathSegments
import dev.pi.postbox.protocol.POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER
import dev.pi.postbox.protocol.POSTBOX_PROTOCOL_VERSION_HEADER
import dev.pi.postbox.protocol.ProtocolCompatibilityGate
import dev.pi.postbox.protocol.ProtocolMessageSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface FcmTokenRegistrar {
    suspend fun register(baseUrl: String, token: String)
}

@Serializable
internal data class FcmTokenRegistrationPayload(
    val token: String,
    val platform: String
)

class OkHttpFcmTokenRegistrar(
    private val client: OkHttpClient = defaultProtocolHttpClient(),
    private val compatibilityGate: ProtocolCompatibilityGate = ProtocolCompatibilityGate()
) : FcmTokenRegistrar {
    override suspend fun register(baseUrl: String, token: String) = withContext(Dispatchers.IO) {
        val body = Json.encodeToString(
            FcmTokenRegistrationPayload.serializer(),
            FcmTokenRegistrationPayload(token = token, platform = "android")
        )
        val request = Request.Builder()
            .url(baseUrl.toPostboxBaseUrl().withPathSegments(listOf("api", "push", "fcm-tokens")))
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, compatibilityGate.supportedVersion)
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        client.newCall(request).execute().use { response ->
            compatibilityGate.requireCompatible(
                response.header(POSTBOX_PROTOCOL_VERSION_HEADER),
                ProtocolMessageSource.FCM
            )
            if (!response.isSuccessful) {
                throw PostboxProtocolHttpException(response.code, response.body?.string().orEmpty())
            }
        }
    }
}

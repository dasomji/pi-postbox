package dev.pi.postbox.onboarding

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

interface PostboxHealthVerifier {
    fun verify(baseUrl: String): HealthVerificationResult
}

class OkHttpPostboxHealthVerifier(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.SECONDS)
        .writeTimeout(3, TimeUnit.SECONDS)
        .callTimeout(5, TimeUnit.SECONDS)
        .build(),
    private val json: Json = Json { ignoreUnknownKeys = true }
) : PostboxHealthVerifier {
    override fun verify(baseUrl: String): HealthVerificationResult {
        val healthUrl = baseUrl.toHttpUrlOrNull()
            ?.newBuilder()
            ?.encodedPath("/")
            ?.query(null)
            ?.fragment(null)
            ?.addPathSegment("healthz")
            ?.build()
            ?: return HealthVerificationResult.Rejected(HealthRejectionReason.MALFORMED_HEALTH_RESPONSE)

        val request = Request.Builder()
            .url(healthUrl)
            .get()
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return HealthVerificationResult.Rejected(HealthRejectionReason.MALFORMED_HEALTH_RESPONSE)
                }

                val body = response.body?.string().orEmpty()
                val health = try {
                    json.decodeFromString<PostboxHealthResponse>(body)
                } catch (_: SerializationException) {
                    return HealthVerificationResult.Rejected(HealthRejectionReason.MALFORMED_HEALTH_RESPONSE)
                }

                if (health.service != POSTBOX_SERVICE_NAME || !health.ok) {
                    return HealthVerificationResult.Rejected(HealthRejectionReason.NON_POSTBOX_HEALTH)
                }

                HealthVerificationResult.Valid(
                    baseUrl = baseUrl,
                    service = health.service,
                    version = health.version,
                    protocolVersion = health.protocolVersion
                )
            }
        } catch (exception: IOException) {
            HealthVerificationResult.Unreachable(exception.message ?: "Unable to reach server")
        }
    }

    private companion object {
        const val POSTBOX_SERVICE_NAME = "pi-postbox"
    }
}

sealed class HealthVerificationResult {
    data class Valid(
        val baseUrl: String,
        val service: String,
        val version: String,
        val protocolVersion: String
    ) : HealthVerificationResult()

    data class Rejected(
        val reason: HealthRejectionReason
    ) : HealthVerificationResult()

    data class Unreachable(
        val message: String
    ) : HealthVerificationResult()
}

enum class HealthRejectionReason {
    NON_POSTBOX_HEALTH,
    MALFORMED_HEALTH_RESPONSE
}

@Serializable
private data class PostboxHealthResponse(
    val ok: Boolean,
    val service: String,
    val version: String,
    val protocolVersion: String
)

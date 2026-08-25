package dev.pi.postbox.protocol

import java.io.IOException
import java.time.Instant
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

const val POSTBOX_PROTOCOL_VERSION_HEADER = "X-Postbox-Protocol-Version"
const val POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER = "X-Postbox-Client-Protocol-Version"

enum class ProtocolMessageSource(val displayName: String) {
    HEALTH("server health"),
    STATE_HTTP("state response"),
    STATE_STREAM("state update"),
    QUESTION_CHAT_HTTP("Question Chat response"),
    QUESTION_CHAT_STREAM("Question Chat update"),
    FCM("push update")
}

enum class ProtocolMismatchReason {
    MISSING_VERSION,
    DIFFERENT_VERSION
}

data class ProtocolMismatch(
    val supportedVersion: String,
    val receivedVersion: String?,
    val source: ProtocolMessageSource,
    val observedAt: Instant,
    val reason: ProtocolMismatchReason
) {
    val receivedVersionLabel: String get() = receivedVersion ?: "missing"
}

sealed interface ProtocolCompatibilityDecision {
    data object Compatible : ProtocolCompatibilityDecision
    data class Incompatible(val mismatch: ProtocolMismatch) : ProtocolCompatibilityDecision
}

class PostboxProtocolMismatchException(
    val mismatch: ProtocolMismatch
) : IOException(
    "Postbox protocol mismatch from ${mismatch.source.displayName}: " +
        "supported ${mismatch.supportedVersion}, received ${mismatch.receivedVersionLabel}"
)

class ProtocolCompatibilityGate(
    private val clock: () -> Instant = Instant::now
) {
    val supportedVersion: String get() = GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION

    fun decide(receivedVersion: String?, source: ProtocolMessageSource): ProtocolCompatibilityDecision {
        if (receivedVersion == supportedVersion) return ProtocolCompatibilityDecision.Compatible

        val safeReceived = receivedVersion?.toPrivacySafeVersion()
        return ProtocolCompatibilityDecision.Incompatible(
            ProtocolMismatch(
                supportedVersion = supportedVersion,
                receivedVersion = safeReceived,
                source = source,
                observedAt = clock(),
                reason = if (receivedVersion == null) {
                    ProtocolMismatchReason.MISSING_VERSION
                } else {
                    ProtocolMismatchReason.DIFFERENT_VERSION
                }
            )
        )
    }

    fun requireCompatible(receivedVersion: String?, source: ProtocolMessageSource) {
        when (val decision = decide(receivedVersion, source)) {
            ProtocolCompatibilityDecision.Compatible -> Unit
            is ProtocolCompatibilityDecision.Incompatible -> throw PostboxProtocolMismatchException(decision.mismatch)
        }
    }

    fun <T> decodeVersioned(rawMessage: String, source: ProtocolMessageSource, decoder: (String) -> T): T {
        requireCompatible(extractReportedVersion(rawMessage), source)
        return decoder(rawMessage)
    }

    fun <T> decodeHttpResponse(
        rawMessage: String,
        statusCode: Int,
        responseProtocolVersion: String?,
        source: ProtocolMessageSource,
        decoder: (JsonObject) -> T
    ): T {
        requireCompatibleHttpResponse(statusCode, rawMessage, responseProtocolVersion, source)
        val body = parseVersionedObject(rawMessage, source)
        return decoder(body)
    }

    fun requireCompatibleHttpResponse(
        statusCode: Int,
        rawMessage: String,
        responseProtocolVersion: String?,
        source: ProtocolMessageSource
    ) {
        if (statusCode !in 200..299 && responseProtocolVersion == null) {
            throw PostboxProtocolHttpException(statusCode, rawMessage)
        }
        requireCompatible(responseProtocolVersion, source)
    }

    private fun parseVersionedObject(rawMessage: String, source: ProtocolMessageSource): JsonObject {
        val objectValue = runCatching { PostboxProtocolJson.json.parseToJsonElement(rawMessage) as? JsonObject }.getOrNull()
        val primitive = objectValue?.get("protocolVersion") as? JsonPrimitive
        val reportedVersion = primitive?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
        requireCompatible(reportedVersion, source)
        return checkNotNull(objectValue) { "Postbox response body must be a JSON object" }
    }

    fun extractReportedVersion(rawMessage: String): String? {
        val objectValue = runCatching { PostboxProtocolJson.json.parseToJsonElement(rawMessage) as? JsonObject }.getOrNull()
            ?: return null
        val primitive = objectValue["protocolVersion"] as? JsonPrimitive ?: return null
        return runCatching { primitive.jsonPrimitive.content }.getOrNull()
    }
}

private val SAFE_VERSION_PATTERN = Regex("[A-Za-z0-9][A-Za-z0-9._+-]{0,63}")

private fun String.toPrivacySafeVersion(): String = takeIf { SAFE_VERSION_PATTERN.matches(it) } ?: "<invalid>"

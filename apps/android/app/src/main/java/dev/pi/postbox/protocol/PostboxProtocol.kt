package dev.pi.postbox.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * Synthetic answer value the server accepts alongside a question's own options,
 * mirroring OTHER_OPTION_VALUE in the web protocol package.
 */
const val OTHER_OPTION_VALUE = "other"

object PostboxProtocolJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun decodeStateSnapshot(value: String): StateSnapshot = json.decodeFromString(value)

    fun encodeAnswerPayload(payload: AskAnswerPayload): String = json.encodeToString(AskAnswerPayload.serializer(), payload)

    fun encodeCancelPayload(payload: AskCancelPayload): String = json.encodeToString(AskCancelPayload.serializer(), payload)
}

@Serializable
data class StateSnapshot(
    val sessions: List<SessionSnapshot>,
    val requests: List<AskRequestSnapshot> = emptyList(),
    val timestamp: String
)

@Serializable
data class SessionSnapshot(
    val sessionId: String,
    val title: String? = null,
    val machineId: String,
    val machineName: String,
    val hostname: String,
    val projectId: String,
    val projectName: String,
    val projectDetectedName: String? = null,
    val projectDescription: String? = null,
    val projectIcon: ProjectIcon? = null,
    val cwd: String,
    val gitRoot: String? = null,
    val repoName: String? = null,
    val branch: String? = null,
    val headSha: String? = null,
    val isDirty: Boolean? = null,
    val worktreePath: String? = null,
    val semanticState: SemanticState,
    val presence: PresenceState,
    val lastHeartbeatAt: String? = null,
    val connectedAt: String? = null,
    val disconnectedAt: String? = null,
    val updatedAt: String
)

@Serializable
data class ProjectIcon(
    val hash: String,
    val dataUrl: String,
    val mediaType: String? = null,
    val sizeBytes: Int? = null
)

@Serializable
enum class SemanticState {
    @SerialName("working") WORKING,
    @SerialName("blocked") BLOCKED,
    @SerialName("idle") IDLE,
    @SerialName("unknown") UNKNOWN
}

@Serializable
enum class PresenceState {
    @SerialName("live") LIVE,
    @SerialName("stale") STALE,
    @SerialName("offline") OFFLINE
}

@Serializable
data class AskRequestSnapshot(
    val requestId: String,
    val sessionId: String,
    val mode: AskMode,
    val question: AskQuestion,
    val options: List<AskOption>,
    val context: HandoffContext? = null,
    val forkReference: ForkReference? = null,
    val status: AskStatus,
    val createdAt: String,
    val expiresAt: String? = null,
    val resolvedAt: String? = null,
    val result: AskResult? = null
)

@Serializable
enum class AskMode {
    @SerialName("single") SINGLE,
    @SerialName("multi") MULTI
}

@Serializable
enum class AskStatus {
    @SerialName("pending") PENDING,
    @SerialName("answered") ANSWERED,
    @SerialName("cancelled") CANCELLED,
    @SerialName("expired") EXPIRED
}

@Serializable
enum class AskResultStatus {
    @SerialName("answered") ANSWERED,
    @SerialName("cancelled") CANCELLED,
    @SerialName("expired") EXPIRED,
    @SerialName("unavailable") UNAVAILABLE
}

@Serializable
data class AskQuestion(
    val prompt: String,
    val context: String? = null,
    val relevance: String? = null,
    val decisionImpact: String? = null
)

@Serializable
data class AskOption(
    val value: String,
    val label: String,
    val description: String? = null,
    val meaning: String? = null,
    val context: String? = null
)

@Serializable
data class HandoffContext(
    val codebaseContext: String? = null,
    val problemContext: String? = null,
    val additionalInfo: List<RichContextItem>? = null
)

@Serializable
data class RichContextItem(
    val kind: String = "text",
    val title: String? = null,
    val content: String,
    val language: String? = null
)

@Serializable
data class ForkReference(
    val agentSessionId: String? = null,
    val agentSessionPath: String? = null,
    val leafId: String? = null,
    val cwd: String? = null,
    val model: String? = null
)

@Serializable
data class AskAnswerPayload(
    val selectedValues: List<String>,
    val note: String? = null
)

@Serializable
data class AskCancelPayload(
    val note: String? = null
)

@Serializable
data class AskResult(
    val status: AskResultStatus,
    val requestId: String? = null,
    val selectedValues: List<String>? = null,
    val note: String? = null,
    val resolvedAt: String? = null
)

@Serializable
data class HealthResponse(
    val ok: Boolean,
    val service: String,
    val version: String,
    val protocolVersion: String,
    val uptimeMs: Long? = null,
    val timestamp: String? = null,
    val localTarget: ActiveLocalTargetIdentity? = null
)

@Serializable
data class ActiveLocalTargetIdentity(
    val role: String,
    val instanceId: String,
    val url: String
)

@Serializable
internal data class PostboxErrorResponse(
    val error: String? = null,
    val code: String? = null,
    val message: String? = null
) {
    companion object {
        fun parse(body: String): PostboxErrorResponse? = try {
            PostboxProtocolJson.json.decodeFromString(serializer(), body)
        } catch (_: SerializationException) {
            null
        }
    }
}

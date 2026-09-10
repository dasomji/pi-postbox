package dev.pi.postbox.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

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

    fun decodeStateSnapshot(value: JsonObject): StateSnapshot = json.decodeFromJsonElement(StateSnapshot.serializer(), value)

    fun encodeAnswerPayload(payload: AskAnswerPayload): String = json.encodeToString(AskAnswerPayload.serializer(), payload)

    fun encodeCancelPayload(payload: AskCancelPayload): String = json.encodeToString(AskCancelPayload.serializer(), payload)
}

@Serializable
data class StateSnapshot(
    val protocolVersion: String = GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION,
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
    val updatedAt: String,
    val repository: RepositoryIdentity? = null,
    val worktree: WorktreeIdentity? = null,
    val feature: FeatureIdentity? = null
)

@Serializable
data class ProjectIcon(
    val hash: String,
    val dataUrl: String,
    val mediaType: String? = null,
    val sizeBytes: Int? = null
)

@Serializable
enum class SemanticState(val wireValue: String) {
    @SerialName("working") WORKING("working"),
    @SerialName("blocked") BLOCKED("blocked"),
    @SerialName("waiting_for_postbox") WAITING_FOR_POSTBOX("waiting_for_postbox"),
    @SerialName("idle") IDLE("idle"),
    @SerialName("unknown") UNKNOWN("unknown")
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
    val revision: Int = 1,
    val ownerRevision: Int = 1,
    val creator: OwnerIdentity? = null,
    val owner: OwnerIdentity? = null,
    val mode: AskMode,
    val question: AskQuestion,
    val options: List<AskOption>,
    val images: List<QuestionImage> = emptyList(),
    val forkReference: ForkReference? = null,
    val status: AskStatus,
    val createdAt: String,
    val expiresAt: String? = null,
    val resolvedAt: String? = null,
    val result: AskResult? = null,
    val answerId: String? = null,
    val answerRead: Boolean? = null,
    val parentQuestionId: String? = null,
    val repository: RepositoryIdentity? = null,
    val worktree: WorktreeIdentity? = null,
    val feature: FeatureIdentity? = null
) {
    init { require(images.size <= 8) { "Question gallery exceeds eight images" } }
}

@Serializable
data class RepositoryIdentity(
    val repositoryId: String,
    val remote: String? = null,
    val machineId: String? = null,
    val commonDirectory: String? = null
)

@Serializable
data class WorktreeIdentity(
    val worktreeId: String,
    val machineId: String,
    val path: String
)

@Serializable
data class FeatureIdentity(
    val featureId: String,
    val name: String? = null
)

@Serializable
data class OwnerIdentity(val harness: String, val ownerId: String)

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
    @SerialName("expired") EXPIRED,
    @SerialName("superseded") SUPERSEDED
}

@Serializable
enum class AskResultStatus {
    @SerialName("answered") ANSWERED,
    @SerialName("cancelled") CANCELLED,
    @SerialName("expired") EXPIRED,
    @SerialName("unavailable") UNAVAILABLE
}

@Serializable
data class QuestionImage(
    val imageId: String, val mediaType: String, val byteSize: Long,
    val width: Int, val height: Int, val alt: String, val caption: String? = null
) {
    init {
        require(imageId.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")))
        require(mediaType in listOf("image/png", "image/jpeg", "image/webp"))
        require(width in 1..8192 && height in 1..8192 && width.toLong() * height <= 25_000_000)
        require(byteSize in 1..(128L * 1024 * 1024))
        require(alt.isNotBlank() && alt.length <= 2000 && (caption?.length ?: 0) <= 2000)
    }
}

@Serializable
data class AskQuestion(
    val prompt: String,
    val ambiguity: String? = null
)

@Serializable
data class AskOption(
    val value: String,
    val label: String,
    val description: String? = null,
    val impact: String? = null,
    val provenance: AskOptionProvenance? = null
)

@Serializable
enum class AskOptionProvenance {
    @SerialName("chat") CHAT
}

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
    val expectedRevision: Int,
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
    val buildId: String,
    val protocolVersion: String,
    val profile: ServerProfileIdentity,
    val uptimeMs: Long? = null,
    val timestamp: String? = null,
    val instance: ServerInstanceIdentity? = null
)

@Serializable
data class ServerProfileIdentity(
    val kind: String,
    val id: String
)

@Serializable
data class ServerInstanceIdentity(
    val profile: ServerProfileIdentity,
    val instanceId: String,
    val url: String,
    val protocolVersion: String,
    val buildId: String
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

        fun parse(body: JsonObject): PostboxErrorResponse? = try {
            PostboxProtocolJson.json.decodeFromJsonElement(serializer(), body)
        } catch (_: SerializationException) {
            null
        }
    }
}

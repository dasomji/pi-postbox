package dev.pi.postbox.questionchat

import java.io.IOException

object QuestionChatTransportLimits {
    const val SNAPSHOT_JSON_BODY_MAX_BYTES = 32 * 1024 * 1024
    const val SMALL_JSON_BODY_MAX_BYTES = 256 * 1024
    const val SSE_EVENT_DATA_MAX_BYTES = 256 * 1024
    const val SSE_LINE_MAX_BYTES = SSE_EVENT_DATA_MAX_BYTES
    const val SSE_FIELD_COUNT_MAX = 64
    const val SSE_DATA_LINE_COUNT_MAX = 64
}

class QuestionChatTransportException(message: String, cause: Throwable? = null) : IOException(message, cause)

enum class QuestionChatAvailabilityCode {
    REQUEST_MISSING,
    REQUEST_NOT_PENDING,
    EXTENSION_OFFLINE,
    SOURCE_PATH_MISSING,
    SOURCE_LEAF_MISSING,
    WRONG_OWNER,
    COMMAND_TIMEOUT,
    RUNTIME_FAILURE,
    CHAT_NOT_STARTED,
    INVALID_COMMAND,
    DUPLICATE_COMMAND,
    RUNTIME_BUSY,
    FORBIDDEN_ORIGIN,
    RATE_LIMITED;

    companion object {
        fun fromWire(value: String): QuestionChatAvailabilityCode = when (value) {
            "request_missing" -> REQUEST_MISSING
            "request_not_pending" -> REQUEST_NOT_PENDING
            "extension_offline" -> EXTENSION_OFFLINE
            "source_path_missing" -> SOURCE_PATH_MISSING
            "source_leaf_missing" -> SOURCE_LEAF_MISSING
            "wrong_owner" -> WRONG_OWNER
            "command_timeout" -> COMMAND_TIMEOUT
            "runtime_failure" -> RUNTIME_FAILURE
            "chat_not_started" -> CHAT_NOT_STARTED
            "invalid_command" -> INVALID_COMMAND
            "duplicate_command" -> DUPLICATE_COMMAND
            "runtime_busy" -> RUNTIME_BUSY
            "forbidden_origin" -> FORBIDDEN_ORIGIN
            "rate_limited" -> RATE_LIMITED
            else -> throw QuestionChatTransportException("Unknown Question Chat availability code: $value")
        }
    }
}

data class QuestionChatAvailabilityError(
    val code: QuestionChatAvailabilityCode,
    val message: String,
    val retryAfterMs: Long? = null
)

enum class QuestionChatForkKind {
    FRESH;

    companion object {
        fun fromWire(value: String): QuestionChatForkKind = when (value) {
            "fresh" -> FRESH
            else -> throw QuestionChatTransportException("Unknown Question Chat fork kind: $value")
        }
    }
}

enum class QuestionChatModelSource {
    POSTBOX_SETTINGS,
    PI_DEFAULT;

    companion object {
        fun fromWire(value: String): QuestionChatModelSource = when (value) {
            "postbox-settings" -> POSTBOX_SETTINGS
            "pi-default" -> PI_DEFAULT
            else -> throw QuestionChatTransportException("Unknown Question Chat model source: $value")
        }
    }
}

data class QuestionChatModel(
    val id: String,
    val source: QuestionChatModelSource,
    val effort: String? = null,
    val fallbackReason: String? = null
)

enum class QuestionChatState {
    READY,
    GENERATING,
    STOPPING,
    STOPPED,
    INTERRUPTED;

    companion object {
        fun fromWire(value: String): QuestionChatState = when (value) {
            "ready" -> READY
            "generating" -> GENERATING
            "stopping" -> STOPPING
            "stopped" -> STOPPED
            "interrupted" -> INTERRUPTED
            else -> throw QuestionChatTransportException("Unknown Question Chat state: $value")
        }
    }
}

sealed interface QuestionChatMessage {
    val id: String

    data class User(
        override val id: String,
        val text: String
    ) : QuestionChatMessage

    data class Assistant(
        override val id: String,
        val text: String,
        val status: Status
    ) : QuestionChatMessage {
        enum class Status {
            STREAMING,
            FINAL,
            STOPPED,
            INTERRUPTED;

            companion object {
                fun fromWire(value: String): Status = when (value) {
                    "streaming" -> STREAMING
                    "final" -> FINAL
                    "stopped" -> STOPPED
                    "interrupted" -> INTERRUPTED
                    else -> throw QuestionChatTransportException("Unknown assistant status: $value")
                }
            }
        }
    }
}

data class QuestionChatToolActivity(
    val id: String,
    val tool: String,
    val target: String,
    val state: String,
    val details: String? = null,
    val actionOptionValue: String? = null
)

data class QuestionChatSnapshot(
    val requestId: String,
    val state: QuestionChatState,
    val forkKind: QuestionChatForkKind,
    val model: QuestionChatModel,
    val sequence: Int,
    val messages: List<QuestionChatMessage>,
    val tools: List<QuestionChatToolActivity>
)

sealed interface QuestionChatActivationResult {
    data class Ready(val snapshot: QuestionChatSnapshot) : QuestionChatActivationResult
    data class Unavailable(val error: QuestionChatAvailabilityError) : QuestionChatActivationResult
}

sealed interface QuestionChatProbeResult {
    data class Ready(val snapshot: QuestionChatSnapshot) : QuestionChatProbeResult
    data object NotStarted : QuestionChatProbeResult
    data class Unavailable(val error: QuestionChatAvailabilityError) : QuestionChatProbeResult
}

enum class QuestionChatSendMode {
    TURN,
    STEER;

    companion object {
        fun fromWire(value: String): QuestionChatSendMode = when (value) {
            "turn" -> TURN
            "steer" -> STEER
            else -> throw QuestionChatTransportException("Unknown Question Chat send mode: $value")
        }
    }
}

sealed interface QuestionChatSnapshotResult {
    data class Ready(val snapshot: QuestionChatSnapshot) : QuestionChatSnapshotResult
    data class Unavailable(val error: QuestionChatAvailabilityError) : QuestionChatSnapshotResult
}

sealed interface QuestionChatCommandResult<out T> {
    data class Accepted<T>(val response: T) : QuestionChatCommandResult<T>
    data class Unavailable(val error: QuestionChatAvailabilityError) : QuestionChatCommandResult<Nothing>
}

data class QuestionChatSendResponse(
    val clientCommandId: String,
    val mode: QuestionChatSendMode? = null
)

data class QuestionChatStopResponse(
    val clientCommandId: String
)

sealed interface QuestionChatStreamEvent {
    val requestId: String

    data class Transport(
        override val requestId: String,
        val online: Boolean
    ) : QuestionChatStreamEvent

    data class Event(
        override val requestId: String,
        val payload: QuestionChatEvent
    ) : QuestionChatStreamEvent
}

sealed interface QuestionChatEvent {
    val requestId: String
    val sequence: Int

    data class Lifecycle(
        override val requestId: String,
        override val sequence: Int,
        val state: QuestionChatState
    ) : QuestionChatEvent

    data class MessageStarted(
        override val requestId: String,
        override val sequence: Int,
        val message: QuestionChatMessage
    ) : QuestionChatEvent

    data class AssistantTextDelta(
        override val requestId: String,
        override val sequence: Int,
        val messageId: String,
        val text: String
    ) : QuestionChatEvent

    data class MessageFinished(
        override val requestId: String,
        override val sequence: Int,
        val messageId: String,
        val text: String,
        val status: QuestionChatMessage.Assistant.Status
    ) : QuestionChatEvent

    data class ToolStarted(
        override val requestId: String,
        override val sequence: Int,
        val activity: QuestionChatToolActivity
    ) : QuestionChatEvent

    data class ToolFinished(
        override val requestId: String,
        override val sequence: Int,
        val activity: QuestionChatToolActivity
    ) : QuestionChatEvent
}

sealed interface QuestionChatEventTransportFact {
    data object Open : QuestionChatEventTransportFact
    data class Event(val event: QuestionChatStreamEvent) : QuestionChatEventTransportFact
    data class Stale(val throwable: Throwable) : QuestionChatEventTransportFact
    data class Failure(val throwable: Throwable) : QuestionChatEventTransportFact
    data class IncompatibleProtocol(val mismatch: dev.pi.postbox.protocol.ProtocolMismatch) : QuestionChatEventTransportFact
    data object EndOfStream : QuestionChatEventTransportFact
}

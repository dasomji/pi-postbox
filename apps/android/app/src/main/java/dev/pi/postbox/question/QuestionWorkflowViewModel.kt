package dev.pi.postbox.question

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.pi.postbox.notification.NotificationPermissionState
import dev.pi.postbox.notification.PendingQuestionNotification
import dev.pi.postbox.notification.PendingQuestionNotificationTracker
import dev.pi.postbox.protocol.AskAnswerPayload
import dev.pi.postbox.protocol.AskCancelPayload
import dev.pi.postbox.protocol.AskMode
import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.PostboxProtocolClient
import dev.pi.postbox.protocol.PostboxRequestAlreadyResolvedException
import dev.pi.postbox.protocol.PostboxStateStream
import dev.pi.postbox.protocol.PostboxStateStreamStatus
import dev.pi.postbox.protocol.SessionSnapshot
import dev.pi.postbox.protocol.StateSnapshot
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class QuestionWorkflowViewModel(
    baseUrl: String,
    private val protocolClient: PostboxProtocolClient,
    private val stateStream: PostboxStateStream,
    private val coroutineScope: CoroutineScope,
    initialNotificationPermissionState: NotificationPermissionState = NotificationPermissionState.Unknown,
    private val pendingQuestionNotificationTracker: PendingQuestionNotificationTracker? = null,
    private val onPendingQuestionNotifications: (List<PendingQuestionNotification>) -> Unit = {}
) {
    var state: QuestionWorkflowState by mutableStateOf(
        QuestionWorkflowState(
            baseUrl = baseUrl,
            notificationStatusMessage = initialNotificationPermissionState.toAvailability().statusMessage
        )
    )
        private set

    private var latestSnapshot: StateSnapshot? = null
    private var streamJob: Job? = null
    private var started = false
    @Volatile private var observationActive = false
    private var notificationOpenRequestId: String? = null

    fun start() {
        if (started) return
        started = true
        observationActive = true

        streamJob = coroutineScope.launch(context = Dispatchers.Unconfined, start = CoroutineStart.UNDISPATCHED) {
            stateStream.states.collect { status -> handleStreamStatus(status) }
        }
        stateStream.start()
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) { refreshState() }
    }

    fun updateNotificationPermissionState(permissionState: NotificationPermissionState) {
        state = state.copy(notificationStatusMessage = permissionState.toAvailability().statusMessage)
    }

    fun openQuestionFromNotification(requestId: String) {
        notificationOpenRequestId = requestId
        selectQuestion(requestId)
    }

    fun selectQuestion(requestId: String) {
        val snapshot = latestSnapshot ?: return
        val request = snapshot.requests.firstOrNull { it.requestId == requestId } ?: return
        state = state.copy(
            visibleQuestion = request.toUiQuestion(
                previous = if (state.visibleQuestion?.requestId == requestId) state.visibleQuestion else null
            ),
            terminalMessage = null
        )
    }

    fun toggleOption(value: String) {
        val visible = state.visibleQuestion ?: return
        if (!visible.availableActions.contains(QuestionAction.SUBMIT)) return

        val selected = when (visible.mode) {
            QuestionMode.SINGLE -> if (visible.selectedValues == listOf(value)) emptyList() else listOf(value)
            QuestionMode.MULTI -> {
                if (visible.selectedValues.contains(value)) {
                    visible.selectedValues.filterNot { it == value }
                } else {
                    visible.selectedValues + value
                }
            }
        }

        state = state.copy(
            visibleQuestion = visible.copy(
                selectedValues = selected,
                submissionError = null
            ).withSubmitState()
        )
    }

    fun submitAnswer(note: String? = null, rationale: String? = null) {
        val visible = state.visibleQuestion ?: return
        if (visible.isSubmitting || !visible.canSubmit) return

        state = state.copy(
            visibleQuestion = visible.copy(isSubmitting = true, submissionError = null).withSubmitState()
        )
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                protocolClient.answerRequest(
                    requestId = visible.requestId,
                    payload = AskAnswerPayload(
                        selectedValues = visible.selectedValues,
                        note = note,
                        rationale = rationale
                    )
                )
                refreshState(previousVisible = visible, preferFirstPending = true)
            } catch (exception: PostboxRequestAlreadyResolvedException) {
                refreshState(
                    previousVisible = visible,
                    forceVisibleRequestId = visible.requestId,
                    terminalState = QuestionTerminalState.ALREADY_RESOLVED,
                    terminalMessage = QuestionTerminalMessage(
                        requestId = visible.requestId,
                        message = exception.serverMessage ?: exception.message ?: "Request is already resolved."
                    )
                )
            } catch (exception: IOException) {
                showSubmissionError(exception)
            } catch (exception: RuntimeException) {
                showSubmissionError(exception)
            }
        }
    }

    fun cancelQuestion(note: String? = null, rationale: String? = null) {
        val visible = state.visibleQuestion ?: return
        if (visible.isSubmitting || !visible.availableActions.contains(QuestionAction.CANCEL)) return

        state = state.copy(visibleQuestion = visible.copy(isSubmitting = true, submissionError = null))
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                protocolClient.cancelRequest(
                    requestId = visible.requestId,
                    payload = AskCancelPayload(note = note, rationale = rationale)
                )
                refreshState(
                    previousVisible = visible,
                    forceVisibleRequestId = visible.requestId,
                    terminalState = QuestionTerminalState.CANCELLED,
                    terminalMessage = QuestionTerminalMessage(
                        requestId = visible.requestId,
                        message = "Question cancelled."
                    )
                )
            } catch (exception: PostboxRequestAlreadyResolvedException) {
                refreshState(
                    previousVisible = visible,
                    forceVisibleRequestId = visible.requestId,
                    terminalState = QuestionTerminalState.ALREADY_RESOLVED,
                    terminalMessage = QuestionTerminalMessage(
                        requestId = visible.requestId,
                        message = exception.serverMessage ?: exception.message ?: "Request is already resolved."
                    )
                )
            } catch (exception: IOException) {
                showSubmissionError(exception)
            } catch (exception: RuntimeException) {
                showSubmissionError(exception)
            }
        }
    }

    fun close() {
        observationActive = false
        streamJob?.cancel()
        streamJob = null
        stateStream.close()
        started = false
    }

    private suspend fun refreshState(
        previousVisible: QuestionDetailUiState? = state.visibleQuestion,
        preferFirstPending: Boolean = false,
        forceVisibleRequestId: String? = null,
        terminalState: QuestionTerminalState? = null,
        terminalMessage: QuestionTerminalMessage? = null
    ) {
        state = state.copy(isLoading = latestSnapshot == null, errorMessage = null)
        try {
            val snapshot = protocolClient.fetchState()
            applySnapshot(
                snapshot = snapshot,
                previousVisible = previousVisible,
                preferFirstPending = preferFirstPending,
                forceVisibleRequestId = forceVisibleRequestId,
                forcedTerminalState = terminalState,
                terminalMessage = terminalMessage,
                connectionState = QuestionConnectionState.CONNECTED,
                connectionMessage = null
            )
        } catch (exception: IOException) {
            state = state.copy(
                isLoading = false,
                connectionState = QuestionConnectionState.ERROR,
                connectionMessage = exception.message,
                errorMessage = exception.message ?: "Unable to load questions."
            )
        } catch (exception: RuntimeException) {
            state = state.copy(
                isLoading = false,
                connectionState = QuestionConnectionState.ERROR,
                connectionMessage = exception.message,
                errorMessage = exception.message ?: "Unable to load questions."
            )
        }
    }

    private fun handleStreamStatus(status: PostboxStateStreamStatus) {
        when (status) {
            PostboxStateStreamStatus.Connecting -> {
                state = state.copy(
                    connectionState = QuestionConnectionState.CONNECTING,
                    connectionMessage = null
                )
            }
            is PostboxStateStreamStatus.Connected -> applySnapshot(
                snapshot = status.latestState,
                previousVisible = state.visibleQuestion,
                connectionState = QuestionConnectionState.CONNECTED,
                connectionMessage = null
            )
            is PostboxStateStreamStatus.Reconnecting -> {
                status.latestState?.let { snapshot ->
                    applySnapshot(
                        snapshot = snapshot,
                        previousVisible = state.visibleQuestion,
                        connectionState = QuestionConnectionState.DISCONNECTED,
                        connectionMessage = status.reason
                    )
                } ?: run {
                    state = state.copy(
                        connectionState = QuestionConnectionState.DISCONNECTED,
                        connectionMessage = status.reason
                    )
                }
            }
            is PostboxStateStreamStatus.Disconnected -> {
                status.latestState?.let { snapshot ->
                    applySnapshot(
                        snapshot = snapshot,
                        previousVisible = state.visibleQuestion,
                        connectionState = QuestionConnectionState.DISCONNECTED,
                        connectionMessage = status.reason
                    )
                } ?: run {
                    state = state.copy(
                        connectionState = QuestionConnectionState.DISCONNECTED,
                        connectionMessage = status.reason
                    )
                }
            }
        }
    }

    private fun applySnapshot(
        snapshot: StateSnapshot,
        previousVisible: QuestionDetailUiState?,
        preferFirstPending: Boolean = false,
        forceVisibleRequestId: String? = null,
        forcedTerminalState: QuestionTerminalState? = null,
        terminalMessage: QuestionTerminalMessage? = state.terminalMessage,
        connectionState: QuestionConnectionState = state.connectionState,
        connectionMessage: String? = state.connectionMessage
    ) {
        latestSnapshot = snapshot
        val pendingRequests = snapshot.requests.filter { it.status == AskStatus.PENDING }
        val pendingQuestions = pendingRequests.map { it.toListItem() }
        val requestedVisibleId = forceVisibleRequestId
            ?: notificationOpenRequestId
            ?: if (preferFirstPending) null else previousVisible?.requestId
        val visibleRequest = requestedVisibleId?.let { requestId ->
            snapshot.requests.firstOrNull { it.requestId == requestId }
        } ?: pendingRequests.firstOrNull()

        if (notificationOpenRequestId != null && visibleRequest?.requestId == notificationOpenRequestId) {
            notificationOpenRequestId = null
        }

        val visibleQuestion = visibleRequest?.toUiQuestion(
            previous = previousVisible?.takeIf { it.requestId == visibleRequest.requestId },
            forcedTerminalState = forcedTerminalState
        )

        state = state.copy(
            isLoading = false,
            connectionState = connectionState,
            connectionMessage = connectionMessage,
            sessions = snapshot.sessions.map { it.toUiState() },
            pendingQuestions = pendingQuestions,
            visibleQuestion = visibleQuestion,
            terminalMessage = terminalMessage,
            errorMessage = null
        )

        val notifications = if (observationActive) {
            pendingQuestionNotificationTracker?.observe(snapshot).orEmpty()
        } else {
            emptyList()
        }

        if (notifications.isNotEmpty() && observationActive) {
            runCatching { onPendingQuestionNotifications(notifications) }
        }
    }

    private fun showSubmissionError(exception: Exception) {
        val visible = state.visibleQuestion ?: return
        state = state.copy(
            visibleQuestion = visible.copy(
                isSubmitting = false,
                submissionError = exception.message ?: "Unable to submit this question."
            ).withSubmitState()
        )
    }
}

data class QuestionWorkflowState(
    val baseUrl: String,
    val isLoading: Boolean = true,
    val connectionState: QuestionConnectionState = QuestionConnectionState.CONNECTING,
    val connectionMessage: String? = null,
    val sessions: List<QuestionSessionUiState> = emptyList(),
    val pendingQuestions: List<QuestionListItemUiState> = emptyList(),
    val visibleQuestion: QuestionDetailUiState? = null,
    val terminalMessage: QuestionTerminalMessage? = null,
    val errorMessage: String? = null,
    val notificationStatusMessage: String? = null
)

enum class QuestionConnectionState {
    CONNECTING,
    CONNECTED,
    DISCONNECTED,
    ERROR
}

enum class QuestionTerminalState {
    ANSWERED,
    CANCELLED,
    EXPIRED,
    ALREADY_RESOLVED
}

enum class QuestionAction {
    SUBMIT,
    CANCEL
}

enum class QuestionMode {
    SINGLE,
    MULTI
}

data class QuestionSessionUiState(
    val sessionId: String,
    val title: String?,
    val projectName: String,
    val machineName: String,
    val semanticState: String,
    val presence: String,
    val branch: String?
)

data class QuestionListItemUiState(
    val requestId: String,
    val sessionId: String,
    val prompt: String,
    val mode: QuestionMode,
    val createdAt: String,
    val expiresAt: String?
)

data class QuestionDetailUiState(
    val requestId: String,
    val sessionId: String,
    val mode: QuestionMode,
    val prompt: String,
    val questionContext: String?,
    val relevance: String?,
    val decisionImpact: String?,
    val options: List<QuestionOptionUiState>,
    val handoffContext: dev.pi.postbox.protocol.HandoffContext?,
    val forkReference: dev.pi.postbox.protocol.ForkReference?,
    val selectedValues: List<String> = emptyList(),
    val canSubmit: Boolean = false,
    val isSubmitting: Boolean = false,
    val submissionError: String? = null,
    val terminalState: QuestionTerminalState? = null,
    val availableActions: List<QuestionAction> = emptyList()
)

data class QuestionOptionUiState(
    val value: String,
    val label: String,
    val description: String?
)

data class QuestionTerminalMessage(
    val requestId: String,
    val message: String
)

private fun SessionSnapshot.toUiState(): QuestionSessionUiState = QuestionSessionUiState(
    sessionId = sessionId,
    title = title,
    projectName = projectName,
    machineName = machineName,
    semanticState = semanticState.name.lowercase(),
    presence = presence.name.lowercase(),
    branch = branch
)

private fun AskRequestSnapshot.toListItem(): QuestionListItemUiState = QuestionListItemUiState(
    requestId = requestId,
    sessionId = sessionId,
    prompt = question.prompt,
    mode = mode.toQuestionMode(),
    createdAt = createdAt,
    expiresAt = expiresAt
)

private fun AskRequestSnapshot.toUiQuestion(
    previous: QuestionDetailUiState? = null,
    forcedTerminalState: QuestionTerminalState? = null
): QuestionDetailUiState {
    val terminalState = forcedTerminalState ?: status.toTerminalState()
    val actions = if (status == AskStatus.PENDING && terminalState == null) {
        listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
    } else {
        emptyList()
    }
    return QuestionDetailUiState(
        requestId = requestId,
        sessionId = sessionId,
        mode = mode.toQuestionMode(),
        prompt = question.prompt,
        questionContext = question.context,
        relevance = question.relevance,
        decisionImpact = question.decisionImpact,
        options = options.map { option ->
            QuestionOptionUiState(
                value = option.value,
                label = option.label,
                description = option.description ?: option.meaning ?: option.context
            )
        },
        handoffContext = context,
        forkReference = forkReference,
        selectedValues = previous?.selectedValues.orEmpty(),
        submissionError = previous?.submissionError,
        terminalState = terminalState,
        availableActions = actions
    ).withSubmitState()
}

private fun QuestionDetailUiState.withSubmitState(): QuestionDetailUiState {
    val canSubmit = terminalState == null &&
        availableActions.contains(QuestionAction.SUBMIT) &&
        !isSubmitting &&
        selectedValues.isNotEmpty() &&
        (mode == QuestionMode.MULTI || selectedValues.size == 1)
    return copy(canSubmit = canSubmit)
}

private fun AskMode.toQuestionMode(): QuestionMode = when (this) {
    AskMode.SINGLE -> QuestionMode.SINGLE
    AskMode.MULTI -> QuestionMode.MULTI
}

private fun AskStatus.toTerminalState(): QuestionTerminalState? = when (this) {
    AskStatus.PENDING -> null
    AskStatus.ANSWERED -> QuestionTerminalState.ANSWERED
    AskStatus.CANCELLED -> QuestionTerminalState.CANCELLED
    AskStatus.EXPIRED -> QuestionTerminalState.EXPIRED
}

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
import dev.pi.postbox.protocol.AskOptionProvenance
import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.AskUrgency
import dev.pi.postbox.protocol.OTHER_OPTION_VALUE
import dev.pi.postbox.protocol.PostboxProtocolClient
import dev.pi.postbox.protocol.PostboxRequestAlreadyResolvedException
import dev.pi.postbox.protocol.PostboxStateStream
import dev.pi.postbox.protocol.PostboxStateStreamStatus
import dev.pi.postbox.protocol.SessionSnapshot
import dev.pi.postbox.protocol.StateSnapshot
import dev.pi.postbox.push.PrefetchedStateSnapshotCache
import dev.pi.postbox.questionchat.OkHttpQuestionChatEventTransport
import dev.pi.postbox.questionchat.OkHttpQuestionChatHttpClient
import dev.pi.postbox.questionchat.QuestionChatActivationUiState
import dev.pi.postbox.questionchat.QuestionChatBindingKey
import dev.pi.postbox.questionchat.QuestionChatIntent
import dev.pi.postbox.questionchat.QuestionChatOwner
import dev.pi.postbox.questionchat.QuestionChatOwnerState
import dev.pi.postbox.questionchat.QuestionChatStarter
import dev.pi.postbox.questionchat.QuestionChatSuggestedOptionReview
import dev.pi.postbox.questionchat.QuestionChatWorkspaceShell
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private const val DRAFT_PERSISTENCE_ERROR_MESSAGE =
    "Secure storage failed. Your draft is kept only in this app session and will not survive an app restart."

class QuestionWorkflowViewModel(
    baseUrl: String,
    private val protocolClient: PostboxProtocolClient,
    private val stateStream: PostboxStateStream,
    private val coroutineScope: CoroutineScope,
    initialNotificationPermissionState: NotificationPermissionState = NotificationPermissionState.Unknown,
    private val draftStore: QuestionDraftStore = NoopQuestionDraftStore,
    private val pendingQuestionNotificationTracker: PendingQuestionNotificationTracker? = null,
    private val onPendingQuestionNotifications: (List<PendingQuestionNotification>) -> Unit = {},
    private val onPendingRequestIdsObserved: (Set<String>) -> Unit = {},
    private val prefetchedSnapshotProvider: (String) -> StateSnapshot? = { PrefetchedStateSnapshotCache.freshSnapshotFor(it) },
    private val questionChatOwner: QuestionChatOwner = QuestionChatOwner(
        httpClient = OkHttpQuestionChatHttpClient(baseUrl),
        eventTransport = OkHttpQuestionChatEventTransport(baseUrl),
        scope = coroutineScope
    )
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
    private val questionChatShell = QuestionChatWorkspaceShell()
    private var questionChatActivationRequested = false
    private var hasAuthoritativeSnapshot = false
    @Volatile private var observationActive = false
    private var notificationOpenRequestId: String? = null
    private val draftLoadsStarted = mutableSetOf<QuestionDraftKey>()
    private val draftLoadFailures = mutableSetOf<QuestionDraftKey>()
    private val draftsInMemory = mutableMapOf<QuestionDraftKey, QuestionAnswerDraft>()
    private val draftPersistenceErrors = mutableMapOf<QuestionDraftKey, String>()
    private val draftRevisions = mutableMapOf<QuestionDraftKey, Long>()
    private val draftSaveJobs = mutableMapOf<QuestionDraftKey, Job>()
    private val draftReconcileJobs = mutableMapOf<String, Job>()

    init {
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            questionChatOwner.state.collect {
                updateQuestionChatState()
            }
        }
    }

    fun start() {
        if (started) return
        started = true
        observationActive = true
        questionChatOwner.dispatch(QuestionChatIntent.SetForeground(true))
        state = state.copy(isSyncing = true)

        // A push handler may have fetched fresh state moments ago; render it immediately so an
        // open-from-notification never shows the previous visit's stale queue while syncing.
        prefetchedSnapshotProvider(state.baseUrl)?.let { prefetched ->
            applySnapshot(snapshot = prefetched, previousVisible = state.visibleQuestion)
        }

        streamJob = coroutineScope.launch(context = Dispatchers.Unconfined, start = CoroutineStart.UNDISPATCHED) {
            stateStream.states.collect { status -> handleStreamStatus(status) }
        }
        stateStream.start()
    }

    fun updateNotificationPermissionState(permissionState: NotificationPermissionState) {
        state = state.copy(notificationStatusMessage = permissionState.toAvailability().statusMessage)
    }

    fun openQuestionFromNotification(requestId: String) {
        val knownRequest = latestSnapshot?.requests?.firstOrNull { it.requestId == requestId }
        if (knownRequest != null && knownRequest.status != AskStatus.PENDING) {
            notificationOpenRequestId = null
            showQueue()
            return
        }

        // A warm Activity may still hold the snapshot from before this question was answered.
        // Never render that cached question on a notification tap: show the queue while an
        // explicit fetch confirms whether the target is still pending.
        notificationOpenRequestId = requestId
        showQueue()
        state = state.copy(isSyncing = true)
        if (hasAuthoritativeSnapshot) {
            coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
                refreshState(previousVisible = null)
            }
        }
    }

    fun showQueue() {
        state = state.copy(
            navigationSelection = QuestionNavigationSelection.Queue,
            terminalMessage = null
        )
    }

    fun startQuestionChat() {
        questionChatShell.selectTab(QuestionChatWorkspaceTab.CHAT)
        updateQuestionChatState()
        val ownerState = questionChatOwner.state.value
        if (ownerState.knownStarted && ownerState.session != null) return
        if (questionChatActivationRequested || ownerState.activation == QuestionChatActivationUiState.ActivatingExact) return
        questionChatActivationRequested = true
        questionChatOwner.dispatch(QuestionChatIntent.ActivateExact)
        promoteActivatedQuestionChatIfReady()
    }

    fun confirmContextOnlyQuestionChat() {
        questionChatShell.selectTab(QuestionChatWorkspaceTab.CHAT)
        updateQuestionChatState()
        questionChatActivationRequested = true
        questionChatOwner.dispatch(QuestionChatIntent.ActivateContextFallback)
        promoteActivatedQuestionChatIfReady()
    }

    fun selectQuestionChatTab(tab: QuestionChatWorkspaceTab) {
        questionChatShell.selectTab(tab)
        updateQuestionChatState()
    }

    fun handleBack(): Boolean {
        val handled = questionChatShell.handleBack()
        if (handled) updateQuestionChatState()
        return handled
    }

    fun retryQuestionChat() {
        questionChatOwner.dispatch(QuestionChatIntent.Retry)
    }

    fun updateQuestionChatDraft(text: String) {
        questionChatOwner.dispatch(QuestionChatIntent.DraftChanged(text))
    }

    fun sendQuestionChatDraft() {
        questionChatOwner.dispatch(QuestionChatIntent.SendDraft)
    }

    fun sendQuestionChatStarter(starter: QuestionChatStarter) {
        questionChatOwner.dispatch(QuestionChatIntent.SendStarter(starter))
    }

    fun stopQuestionChat() {
        questionChatOwner.dispatch(QuestionChatIntent.Stop)
    }

    fun reviewQuestionChatSuggestion(optionValue: String) {
        val visible = state.visibleQuestion ?: return
        if (visible.options.any { it.value == optionValue }) {
            questionChatShell.reviewSuggestedOption(optionValue)
            state = state.copy(
                visibleQuestion = visible.copy(
                    submissionError = null
                )
            )
        } else {
            questionChatShell.selectTab(QuestionChatWorkspaceTab.QUESTION)
        }
        updateQuestionChatState()
    }

    fun refreshQuestions() {
        if (state.isRefreshing) return
        state = state.copy(
            isRefreshing = true,
            isSyncing = true,
            errorMessage = null
        )
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                refreshState()
            } finally {
                state = state.copy(isRefreshing = false)
            }
        }
    }

    fun selectProject(projectId: String) {
        if (state.sessions.none { it.projectId == projectId }) return
        state = state.copy(
            navigationSelection = QuestionNavigationSelection.Project(projectId),
            terminalMessage = null
        )
    }

    fun selectSession(sessionId: String) {
        if (state.sessions.none { it.sessionId == sessionId }) return
        state = state.copy(
            navigationSelection = QuestionNavigationSelection.Session(sessionId),
            terminalMessage = null
        )
    }

    fun selectQuestion(requestId: String) {
        val snapshot = latestSnapshot ?: return
        val request = snapshot.requests.firstOrNull { it.requestId == requestId } ?: return
        val key = QuestionDraftKey(state.baseUrl, requestId)
        state = state.copy(
            navigationSelection = QuestionNavigationSelection.Question(requestId),
            visibleQuestion = request.toUiQuestion(
                previous = if (state.visibleQuestion?.requestId == requestId) state.visibleQuestion else null,
                draft = draftsInMemory[key],
                draftPersistenceError = draftPersistenceErrors[key]
            ),
            terminalMessage = null
        )
        synchronizeQuestionChatBinding()
        restoreDraft(request)
    }

    fun toggleOption(value: String) {
        val visible = state.visibleQuestion ?: return
        if (!visible.availableActions.contains(QuestionAction.SUBMIT)) return
        if (value.length > MAX_QUESTION_DRAFT_VALUE_CHARS) return
        if (value != OTHER_OPTION_VALUE && visible.options.none { it.value == value }) return

        val selected = when (visible.mode) {
            QuestionMode.SINGLE -> if (visible.selectedValues == listOf(value)) emptyList() else listOf(value)
            QuestionMode.MULTI -> {
                if (visible.selectedValues.contains(value)) {
                    visible.selectedValues.filterNot { it == value }
                } else if (visible.selectedValues.size < MAX_QUESTION_DRAFT_SELECTED_VALUES) {
                    visible.selectedValues + value
                } else {
                    visible.selectedValues
                }
            }
        }

        state = state.copy(
            visibleQuestion = visible.copy(
                selectedValues = selected,
                submissionError = null
            ).withSubmitState()
        )
        persistVisibleDraft()
    }

    fun updateNote(note: String) {
        val visible = state.visibleQuestion ?: return
        if (visible.availableActions.isEmpty()) return

        state = state.copy(
            visibleQuestion = visible.copy(
                note = note.take(MAX_QUESTION_DRAFT_NOTE_CHARS),
                submissionError = null
            )
        )
        persistVisibleDraft()
    }

    fun retryDraftSave() {
        val visible = state.visibleQuestion ?: return
        val key = QuestionDraftKey(state.baseUrl, visible.requestId)
        val request = latestSnapshot?.requests?.firstOrNull {
            it.requestId == key.requestId && it.status == AskStatus.PENDING
        }
        if (key in draftLoadFailures && key !in draftsInMemory && request != null) {
            draftLoadFailures.remove(key)
            draftLoadsStarted.remove(key)
            restoreDraft(request)
            return
        }
        persistVisibleDraft()
    }

    private fun persistVisibleDraft() {
        val visible = state.visibleQuestion ?: return
        persistDraft(
            key = QuestionDraftKey(state.baseUrl, visible.requestId),
            draft = QuestionAnswerDraft(
                selectedValues = visible.selectedValues,
                note = visible.note
            )
        )
    }

    private fun persistDraft(key: QuestionDraftKey, draft: QuestionAnswerDraft) {
        val currentRequest = latestSnapshot?.requests?.firstOrNull { request ->
            request.requestId == key.requestId && request.status == AskStatus.PENDING
        }
        val sanitizedDraft = currentRequest?.sanitizeDraft(draft) ?: draft.sanitizeBounds()
        draftLoadFailures.remove(key)
        draftsInMemory[key] = sanitizedDraft
        val revision = (draftRevisions[key] ?: 0L) + 1L
        draftRevisions[key] = revision
        val previousSave = draftSaveJobs[key]
        draftSaveJobs[key] = coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            previousSave?.join()
            val result = try {
                draftStore.save(key, sanitizedDraft)
            } catch (_: Exception) {
                QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.WRITE_FAILED)
            }
            if (draftRevisions[key] == revision) {
                updateDraftPersistenceError(
                    key = key,
                    message = if (result is QuestionDraftStoreResult.Failure) {
                        DRAFT_PERSISTENCE_ERROR_MESSAGE
                    } else {
                        null
                    }
                )
            }
        }
    }

    private fun updateDraftPersistenceError(key: QuestionDraftKey, message: String?) {
        if (message == null) {
            draftPersistenceErrors.remove(key)
        } else {
            draftPersistenceErrors[key] = message
        }
        val visible = state.visibleQuestion?.takeIf { it.requestId == key.requestId } ?: return
        if (state.baseUrl != key.normalizedServerUrl) return
        state = state.copy(
            visibleQuestion = visible.copy(draftPersistenceError = message)
        )
    }

    private fun deleteDraft(requestId: String) {
        val key = QuestionDraftKey(state.baseUrl, requestId)
        draftLoadFailures.remove(key)
        draftsInMemory.remove(key)
        updateDraftPersistenceError(key, null)
        draftRevisions[key] = (draftRevisions[key] ?: 0L) + 1L
        val previousSave = draftSaveJobs[key]
        draftSaveJobs[key] = coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            previousSave?.join()
            try {
                draftStore.delete(key)
            } catch (_: Exception) {
                // A cleanup failure must not delay or reverse the server workflow.
            }
        }
    }

    fun submitAnswer(note: String? = null) {
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
                        note = note ?: visible.note.trim().ifBlank { null }
                    )
                )
                deleteDraft(visible.requestId)
                refreshState(
                    previousVisible = visible.copy(draftPersistenceError = null),
                    preferFirstPending = true
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

    /**
     * Manual escape hatch for stuck questions, e.g. when the agent abandoned an
     * ask without telling the server. Cancels the request server-side without
     * requiring it to be the visible question first.
     */
    fun dismissQuestion(requestId: String) {
        if (state.dismissingRequestId != null) return
        state = state.copy(dismissingRequestId = requestId, dismissError = null)
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                protocolClient.cancelRequest(
                    requestId = requestId,
                    payload = AskCancelPayload(note = "Dismissed manually from the Postbox app queue.")
                )
                deleteDraft(requestId)
                refreshState(
                    preferFirstPending = state.navigationSelection ==
                        QuestionNavigationSelection.Question(requestId)
                )
            } catch (exception: PostboxRequestAlreadyResolvedException) {
                // Someone else resolved it in the meantime; the refreshed queue is answer enough.
                refreshState()
            } catch (exception: IOException) {
                state = state.copy(dismissError = exception.message ?: "Unable to dismiss question.")
            } catch (exception: RuntimeException) {
                state = state.copy(dismissError = exception.message ?: "Unable to dismiss question.")
            } finally {
                state = state.copy(dismissingRequestId = null)
            }
        }
    }

    fun cancelQuestion(note: String? = null) {
        val visible = state.visibleQuestion ?: return
        if (visible.isSubmitting || !visible.availableActions.contains(QuestionAction.CANCEL)) return

        state = state.copy(visibleQuestion = visible.copy(isSubmitting = true, submissionError = null))
        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                protocolClient.cancelRequest(
                    requestId = visible.requestId,
                    payload = AskCancelPayload(note = note ?: visible.note.trim().ifBlank { null })
                )
                deleteDraft(visible.requestId)
                refreshState(
                    previousVisible = visible.copy(draftPersistenceError = null),
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
        questionChatOwner.dispatch(QuestionChatIntent.SetForeground(false))
        streamJob?.cancel()
        streamJob = null
        stateStream.close()
        started = false
    }

    fun dispose() {
        close()
        questionChatOwner.close()
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
            hasAuthoritativeSnapshot = true
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
                isSyncing = false,
                connectionState = QuestionConnectionState.ERROR,
                connectionMessage = exception.message,
                errorMessage = exception.message ?: "Unable to load questions."
            )
        } catch (exception: RuntimeException) {
            state = state.copy(
                isLoading = false,
                isSyncing = false,
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
            is PostboxStateStreamStatus.Connected -> {
                hasAuthoritativeSnapshot = true
                applySnapshot(
                    snapshot = status.latestState,
                    previousVisible = state.visibleQuestion,
                    connectionState = QuestionConnectionState.CONNECTED,
                    connectionMessage = null
                )
            }
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
        val pendingRequests = snapshot.requests
            .filter { it.status == AskStatus.PENDING }
            .sortedWith(askRequestPriorityComparator)
        reconcileDraftsForServer(pendingRequests.mapTo(linkedSetOf()) { it.requestId })
        val pendingQuestions = pendingRequests.map { it.toListItem() }
        // Live state is pending-only. If an explicitly refreshed notification target is absent,
        // it resolved in the meantime and must not fall through to an unrelated pending item.
        val staleNotificationOpen = notificationOpenRequestId?.let { requestId ->
            pendingRequests.none { it.requestId == requestId }
        } ?: false
        if (staleNotificationOpen) {
            notificationOpenRequestId = null
        }
        // A question that resolves while it is open on this device (answered, cancelled, or
        // expired elsewhere) disappears back to the queue instead of lingering as a dead form.
        // Local submits and cancels never take this path: they arrive with a forced terminal
        // state, preferFirstPending, or an isSubmitting previous question.
        val previousVisibleRequest = previousVisible?.let { visible ->
            snapshot.requests.firstOrNull { it.requestId == visible.requestId }
        }
        val remotelyResolvedVisible = forceVisibleRequestId == null &&
            forcedTerminalState == null &&
            !preferFirstPending &&
            previousVisible != null &&
            previousVisible.terminalState == null &&
            !previousVisible.isSubmitting &&
            (state.navigationSelection as? QuestionNavigationSelection.Question)?.requestId == previousVisible.requestId &&
            (previousVisibleRequest == null || previousVisibleRequest.status != AskStatus.PENDING)
        val requestedVisibleId = forceVisibleRequestId
            ?: notificationOpenRequestId
            ?: if (preferFirstPending || remotelyResolvedVisible) {
                null
            } else {
                (state.navigationSelection as? QuestionNavigationSelection.Question)?.requestId
                    ?: previousVisible?.requestId
            }
        val visibleRequest = requestedVisibleId?.let { requestId ->
            snapshot.requests.firstOrNull { it.requestId == requestId }
        } ?: if (requestedVisibleId == null && !remotelyResolvedVisible && !staleNotificationOpen) {
            pendingRequests.firstOrNull()
        } else {
            null
        }

        val notificationRequestWasOpened = notificationOpenRequestId != null &&
            visibleRequest?.requestId == notificationOpenRequestId
        if (notificationRequestWasOpened) {
            notificationOpenRequestId = null
        }

        val visibleQuestion = visibleRequest?.let { request ->
            val key = QuestionDraftKey(state.baseUrl, request.requestId)
            request.toUiQuestion(
                previous = previousVisible?.takeIf { it.requestId == request.requestId },
                forcedTerminalState = forcedTerminalState,
                draft = draftsInMemory[key],
                draftPersistenceError = draftPersistenceErrors[key]
            )
        } ?: previousVisible
            ?.takeIf {
                forceVisibleRequestId == it.requestId && forcedTerminalState != null
            }
            ?.copy(
                canSubmit = false,
                isSubmitting = false,
                submissionError = null,
                terminalState = forcedTerminalState,
                availableActions = emptyList()
            )
        val sessions = snapshot.sessions.map { it.toUiState() }
        val navigableSessions = visibleSidebarSessions(sessions, snapshot.timestamp)
        val currentNavigationSelection = state.navigationSelection
        val navigationSelection = when {
            remotelyResolvedVisible -> QuestionNavigationSelection.Queue
            staleNotificationOpen && forceVisibleRequestId == null -> QuestionNavigationSelection.Queue
            preferFirstPending || forceVisibleRequestId != null || notificationRequestWasOpened -> {
                visibleQuestion?.let { QuestionNavigationSelection.Question(it.requestId) }
                    ?: QuestionNavigationSelection.Queue
            }
            currentNavigationSelection == null -> {
                visibleRequest?.let { QuestionNavigationSelection.Question(it.requestId) }
                    ?: QuestionNavigationSelection.Queue
            }
            currentNavigationSelection is QuestionNavigationSelection.Question -> {
                visibleRequest?.let { QuestionNavigationSelection.Question(it.requestId) }
                    ?: QuestionNavigationSelection.Queue
            }
            currentNavigationSelection is QuestionNavigationSelection.Project -> {
                currentNavigationSelection.takeIf { selection ->
                    navigableSessions.any { it.projectId == selection.projectId }
                } ?: QuestionNavigationSelection.Queue
            }
            currentNavigationSelection is QuestionNavigationSelection.Session -> {
                currentNavigationSelection.takeIf { selection ->
                    navigableSessions.any { it.sessionId == selection.sessionId }
                } ?: QuestionNavigationSelection.Queue
            }
            else -> QuestionNavigationSelection.Queue
        }
        val effectiveTerminalMessage = if (remotelyResolvedVisible) {
            QuestionTerminalMessage(
                requestId = previousVisible.requestId,
                message = when (previousVisibleRequest?.status) {
                    AskStatus.ANSWERED -> "This question was answered on another device."
                    AskStatus.CANCELLED -> "This question was cancelled by the agent or another device."
                    AskStatus.EXPIRED -> "This question expired before it was answered."
                    else -> "This question was resolved on another device."
                }
            )
        } else {
            terminalMessage
        }

        state = state.copy(
            isLoading = false,
            isSyncing = false,
            connectionState = connectionState,
            connectionMessage = connectionMessage,
            sessions = sessions,
            snapshotTimestamp = snapshot.timestamp,
            pendingQuestions = pendingQuestions,
            visibleQuestion = visibleQuestion,
            navigationSelection = navigationSelection,
            terminalMessage = effectiveTerminalMessage,
            errorMessage = null
        )
        synchronizeQuestionChatBinding()
        reconcileActiveDraftSelections(pendingRequests)

        if (observationActive) {
            runCatching { onPendingRequestIdsObserved(pendingRequests.mapTo(linkedSetOf()) { it.requestId }) }
        }

        val notifications = if (observationActive) {
            pendingQuestionNotificationTracker?.observe(snapshot).orEmpty()
        } else {
            emptyList()
        }

        if (notifications.isNotEmpty() && observationActive) {
            runCatching { onPendingQuestionNotifications(notifications) }
        }

        visibleRequest?.let(::restoreDraft)
    }

    private fun reconcileActiveDraftSelections(pendingRequests: List<AskRequestSnapshot>) {
        pendingRequests.forEach { request ->
            val key = QuestionDraftKey(state.baseUrl, request.requestId)
            val existing = draftsInMemory[key] ?: return@forEach
            val reconciled = request.sanitizeDraft(existing)
            if (reconciled != existing) {
                persistDraft(key, reconciled)
            }
        }
    }

    private fun reconcileDraftsForServer(activeRequestIds: Set<String>) {
        val normalizedServerUrl = state.baseUrl
        draftsInMemory.keys
            .filter { key ->
                key.normalizedServerUrl == normalizedServerUrl && key.requestId !in activeRequestIds
            }
            .forEach { staleKey ->
                draftLoadFailures.remove(staleKey)
                draftsInMemory.remove(staleKey)
                draftPersistenceErrors.remove(staleKey)
                draftRevisions[staleKey] = (draftRevisions[staleKey] ?: 0L) + 1L
            }

        val previousReconcile = draftReconcileJobs[normalizedServerUrl]
        val precedingWrites = draftSaveJobs
            .filterKeys { it.normalizedServerUrl == normalizedServerUrl }
            .values
            .toList()
        draftReconcileJobs[normalizedServerUrl] = coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            previousReconcile?.join()
            precedingWrites.forEach { it.join() }
            try {
                draftStore.reconcileServer(normalizedServerUrl, activeRequestIds)
            } catch (_: Exception) {
                // Best-effort cleanup is retried by every later authoritative snapshot.
            }
        }
    }

    private fun restoreDraft(request: AskRequestSnapshot) {
        val key = QuestionDraftKey(state.baseUrl, request.requestId)
        if (!draftLoadsStarted.add(key)) return
        val revisionAtStart = draftRevisions[key] ?: 0L

        coroutineScope.launch(start = CoroutineStart.UNDISPATCHED) {
            val result = try {
                draftStore.load(key)
            } catch (_: Exception) {
                QuestionDraftStoreResult.Failure(QuestionDraftStoreFailure.READ_FAILED)
            }
            if ((draftRevisions[key] ?: 0L) != revisionAtStart) return@launch
            if (result is QuestionDraftStoreResult.Failure) {
                draftLoadFailures.add(key)
                updateDraftPersistenceError(key, DRAFT_PERSISTENCE_ERROR_MESSAGE)
                return@launch
            }
            draftLoadFailures.remove(key)
            updateDraftPersistenceError(key, null)
            val draft = (result as QuestionDraftStoreResult.Success).value ?: return@launch
            val currentRequest = latestSnapshot?.requests?.firstOrNull {
                it.requestId == key.requestId && it.status == AskStatus.PENDING
            } ?: return@launch
            val sanitizedDraft = currentRequest.sanitizeDraft(draft)
            if (sanitizedDraft == draft) {
                draftsInMemory[key] = sanitizedDraft
            } else {
                persistDraft(key, sanitizedDraft)
            }
            val currentVisible = state.visibleQuestion?.takeIf { it.requestId == key.requestId } ?: return@launch
            state = state.copy(
                visibleQuestion = currentRequest.toUiQuestion(
                    previous = currentVisible,
                    draft = sanitizedDraft,
                    draftPersistenceError = draftPersistenceErrors[key]
                )
            )
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

    private fun promoteActivatedQuestionChatIfReady() {
        val ownerState = questionChatOwner.state.value
        if (questionChatActivationRequested && ownerState.knownStarted && ownerState.session != null && !questionChatShell.state.runtimeReady) {
            questionChatShell.onActivatedRuntimeReady()
            questionChatActivationRequested = false
            updateQuestionChatState()
        }
    }

    private fun synchronizeQuestionChatBinding() {
        val key = state.visibleQuestion
            ?.takeIf { it.terminalState == null && it.availableActions.isNotEmpty() }
            ?.let { QuestionChatBindingKey(state.baseUrl, it.requestId) }
        val previousKey = questionChatOwner.state.value.key
        if (questionChatShell.state.key != key) {
            questionChatActivationRequested = false
        }
        if (previousKey != null && previousKey != key && questionChatShouldBecomeTerminal(previousKey)) {
            questionChatOwner.dispatch(QuestionChatIntent.QuestionBecameTerminal)
        }
        questionChatShell.bind(key)
        questionChatOwner.bind(key)
        updateQuestionChatState()
    }

    private fun questionChatShouldBecomeTerminal(previousKey: QuestionChatBindingKey): Boolean {
        val visible = state.visibleQuestion
        if (visible?.requestId == previousKey.requestId) {
            return visible.terminalState != null || visible.availableActions.isEmpty()
        }
        return latestSnapshot?.requests?.none {
            it.requestId == previousKey.requestId && it.status == AskStatus.PENDING
        } ?: false
    }

    private fun updateQuestionChatState() {
        val ownerState = questionChatOwner.state.value
        if (ownerState.key != null && ownerState.knownStarted && ownerState.session != null && !questionChatShell.state.runtimeReady) {
            if (questionChatActivationRequested) {
                questionChatShell.onActivatedRuntimeReady()
                questionChatActivationRequested = false
            } else {
                questionChatShell.onRecoveredRuntimeDiscovered()
            }
        }
        val shellState = questionChatShell.state
        val suggestedOptionReview = shellState.suggestedOptionReview?.takeIf { review ->
            state.visibleQuestion?.options?.any { option -> option.value == review.optionValue } == true
        }
        state = state.copy(
            questionChat = shellState.key?.let { key ->
                QuestionChatWorkflowUiState(
                    key = key,
                    owner = ownerState,
                    tabsVisible = shellState.tabsVisible,
                    selectedTab = shellState.selectedTab,
                    questionFocusToken = shellState.questionFocusToken,
                    suggestedOptionReview = suggestedOptionReview
                )
            }
        )
    }
}

data class QuestionWorkflowState(
    val baseUrl: String,
    val isLoading: Boolean = true,
    /** True only while a user-initiated refresh is fetching an authoritative snapshot. */
    val isRefreshing: Boolean = false,
    /** True from (re)start until a state snapshot arrives; empty views show "checking" instead of "all caught up". */
    val isSyncing: Boolean = true,
    val connectionState: QuestionConnectionState = QuestionConnectionState.CONNECTING,
    val connectionMessage: String? = null,
    val sessions: List<QuestionSessionUiState> = emptyList(),
    val snapshotTimestamp: String? = null,
    val pendingQuestions: List<QuestionListItemUiState> = emptyList(),
    val visibleQuestion: QuestionDetailUiState? = null,
    val navigationSelection: QuestionNavigationSelection? = null,
    val questionChat: QuestionChatWorkflowUiState? = null,
    val terminalMessage: QuestionTerminalMessage? = null,
    val errorMessage: String? = null,
    val notificationStatusMessage: String? = null,
    val dismissingRequestId: String? = null,
    val dismissError: String? = null
)

data class QuestionChatWorkflowUiState(
    val key: QuestionChatBindingKey,
    val owner: QuestionChatOwnerState,
    val tabsVisible: Boolean,
    val selectedTab: QuestionChatWorkspaceTab,
    val questionFocusToken: Long,
    val suggestedOptionReview: QuestionChatSuggestedOptionReview? = null
)

sealed interface QuestionNavigationSelection {
    data object Queue : QuestionNavigationSelection
    data class Project(val projectId: String) : QuestionNavigationSelection
    data class Session(val sessionId: String) : QuestionNavigationSelection
    data class Question(val requestId: String) : QuestionNavigationSelection
}

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

enum class QuestionUrgency {
    HIGH,
    NORMAL,
    LOW
}

data class QuestionSessionUiState(
    val sessionId: String,
    val title: String?,
    val projectId: String,
    val projectName: String,
    val machineName: String,
    val semanticState: String,
    val presence: String,
    val branch: String?,
    val disconnectedAt: String? = null
)

data class QuestionListItemUiState(
    val requestId: String,
    val sessionId: String,
    val prompt: String,
    val mode: QuestionMode,
    val createdAt: String,
    val expiresAt: String?,
    val urgency: QuestionUrgency = QuestionUrgency.NORMAL
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
    val urgency: QuestionUrgency = QuestionUrgency.NORMAL,
    val selectedValues: List<String> = emptyList(),
    val note: String = "",
    val canSubmit: Boolean = false,
    val isSubmitting: Boolean = false,
    val submissionError: String? = null,
    val draftPersistenceError: String? = null,
    val terminalState: QuestionTerminalState? = null,
    val availableActions: List<QuestionAction> = emptyList()
)

data class QuestionOptionUiState(
    val value: String,
    val label: String,
    val description: String?,
    val meaning: String? = null,
    val context: String? = null,
    val provenance: QuestionOptionProvenance? = null
)

enum class QuestionOptionProvenance {
    CHAT
}

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
    branch = branch,
    disconnectedAt = disconnectedAt,
    projectId = projectId
)

private fun AskRequestSnapshot.toListItem(): QuestionListItemUiState = QuestionListItemUiState(
    requestId = requestId,
    sessionId = sessionId,
    prompt = question.prompt,
    mode = mode.toQuestionMode(),
    urgency = urgency.toQuestionUrgency(),
    createdAt = createdAt,
    expiresAt = expiresAt
)

private fun AskRequestSnapshot.toUiQuestion(
    previous: QuestionDetailUiState? = null,
    forcedTerminalState: QuestionTerminalState? = null,
    draft: QuestionAnswerDraft? = null,
    draftPersistenceError: String? = previous?.draftPersistenceError
): QuestionDetailUiState {
    val terminalState = forcedTerminalState ?: status.toTerminalState()
    val actions = if (status == AskStatus.PENDING && terminalState == null) {
        listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
    } else {
        emptyList()
    }
    val sanitizedDraft = sanitizeDraft(
        QuestionAnswerDraft(
            selectedValues = draft?.selectedValues ?: previous?.selectedValues.orEmpty(),
            note = draft?.note ?: previous?.note.orEmpty()
        )
    )
    return QuestionDetailUiState(
        requestId = requestId,
        sessionId = sessionId,
        mode = mode.toQuestionMode(),
        urgency = urgency.toQuestionUrgency(),
        prompt = question.prompt,
        questionContext = question.context,
        relevance = question.relevance,
        decisionImpact = question.decisionImpact,
        options = options.map { option ->
            QuestionOptionUiState(
                value = option.value,
                label = option.label,
                description = option.description,
                meaning = option.meaning,
                context = option.context,
                provenance = option.provenance?.toQuestionOptionProvenance()
            )
        },
        handoffContext = context,
        forkReference = forkReference,
        selectedValues = sanitizedDraft.selectedValues,
        note = sanitizedDraft.note,
        submissionError = previous?.submissionError,
        draftPersistenceError = draftPersistenceError,
        terminalState = terminalState,
        availableActions = actions
    ).withSubmitState()
}

private fun AskRequestSnapshot.sanitizeDraft(draft: QuestionAnswerDraft): QuestionAnswerDraft {
    val validOptionValues = options.mapTo(hashSetOf()) { it.value }
    return draft.sanitizeBounds().copy(
        selectedValues = draft.selectedValues
            .asSequence()
            .filter { it.length <= MAX_QUESTION_DRAFT_VALUE_CHARS }
            .filter { it == OTHER_OPTION_VALUE || it in validOptionValues }
            .distinct()
            .take(MAX_QUESTION_DRAFT_SELECTED_VALUES)
            .let { selectedValues ->
                if (mode == AskMode.SINGLE) selectedValues.take(1) else selectedValues
            }
            .toList()
    )
}

private fun QuestionAnswerDraft.sanitizeBounds(): QuestionAnswerDraft = copy(
    selectedValues = selectedValues
        .asSequence()
        .filter { it.length <= MAX_QUESTION_DRAFT_VALUE_CHARS }
        .distinct()
        .take(MAX_QUESTION_DRAFT_SELECTED_VALUES)
        .toList(),
    note = note.take(MAX_QUESTION_DRAFT_NOTE_CHARS)
)

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

private fun AskUrgency.toQuestionUrgency(): QuestionUrgency = when (this) {
    AskUrgency.HIGH -> QuestionUrgency.HIGH
    AskUrgency.NORMAL -> QuestionUrgency.NORMAL
    AskUrgency.LOW -> QuestionUrgency.LOW
}

private fun AskOptionProvenance.toQuestionOptionProvenance(): QuestionOptionProvenance = when (this) {
    AskOptionProvenance.CHAT -> QuestionOptionProvenance.CHAT
}

private fun AskStatus.toTerminalState(): QuestionTerminalState? = when (this) {
    AskStatus.PENDING -> null
    AskStatus.ANSWERED -> QuestionTerminalState.ANSWERED
    AskStatus.CANCELLED -> QuestionTerminalState.CANCELLED
    AskStatus.EXPIRED -> QuestionTerminalState.EXPIRED
}

package dev.pi.postbox.question

import dev.pi.postbox.notification.NotificationPermissionState
import dev.pi.postbox.notification.PendingQuestionNotification
import dev.pi.postbox.notification.PendingQuestionNotificationTracker
import dev.pi.postbox.protocol.AskAnswerPayload
import dev.pi.postbox.protocol.AskCancelPayload
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.HealthResponse
import dev.pi.postbox.protocol.PostboxProtocolClient
import dev.pi.postbox.protocol.PostboxRequestAlreadyResolvedException
import dev.pi.postbox.protocol.PostboxStateStream
import dev.pi.postbox.protocol.PostboxStateStreamStatus
import dev.pi.postbox.protocol.StateSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionWorkflowViewModelTest {
    @Test
    fun afterVerifiedServerUrlLoadsStateAndDisplaysPendingQuestionsAndSessions() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )

        viewModel.start()
        advanceUntilIdle()

        val state = viewModel.state
        assertFalse(state.isLoading)
        assertEquals(VERIFIED_BASE_URL, state.baseUrl)
        assertEquals(QuestionConnectionState.CONNECTED, state.connectionState)
        assertEquals(1, stream.startCount)
        assertEquals(1, client.fetchStateCalls)
        assertEquals(listOf("session-live", "session-offline"), state.sessions.map { it.sessionId })
        assertEquals(listOf("ask-single", "ask-multi"), state.pendingQuestions.map { it.requestId })
        assertEquals("Choose one deployment target", state.pendingQuestions.first().prompt)
        assertEquals("ask-single", state.visibleQuestion?.requestId)
    }

    @Test
    fun singleSelectAnswerIsDisabledUntilExactlyOneOptionIsSelectedThenSubmitsAndRefreshes() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterAnswer = {
            client.currentState = questionWorkflowState(
                requests = listOf(answeredSingleQuestion(), multiPendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        assertEquals(emptyList<String>(), viewModel.state.visibleQuestion?.selectedValues)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)

        viewModel.toggleOption("tailnet")
        assertEquals(listOf("tailnet"), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.toggleOption("loopback")
        assertEquals(listOf("loopback"), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.submitAnswer(
            note = "Use emulator for this prototype.",
            rationale = "The device smoke is deferred until hardware is available."
        )
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedAnswer("ask-single", listOf("loopback"), "Use emulator for this prototype.", "The device smoke is deferred until hardware is available.")),
            client.answers
        )
        assertEquals(2, client.fetchStateCalls)
        assertEquals(listOf("ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
        assertNull(viewModel.state.visibleQuestion?.submissionError)
    }

    @Test
    fun answerSubmitIsDisabledWhileRequestIsInFlightAndDoesNotPostTwice() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val answerMayComplete = CompletableDeferred<Unit>()
        client.beforeAnswerCompletes = { answerMayComplete.await() }
        client.afterAnswer = {
            client.currentState = questionWorkflowState(
                requests = listOf(answeredSingleQuestion(), multiPendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.toggleOption("loopback")
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.submitAnswer()

        assertEquals(1, client.answers.size)
        assertTrue(viewModel.state.visibleQuestion?.isSubmitting ?: false)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)

        viewModel.submitAnswer()

        assertEquals("second tap while submitting must not post another answer", 1, client.answers.size)

        answerMayComplete.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, client.answers.size)
    }

    @Test
    fun multiSelectAnswerRequiresAtLeastOneSelectedOptionAndAllowsMultipleValues() = runTest {
        val viewModel = startedViewModel(RecordingPostboxProtocolClient(questionWorkflowState()))

        viewModel.selectQuestion("ask-multi")
        assertEquals(emptyList<String>(), viewModel.state.visibleQuestion?.selectedValues)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)

        viewModel.toggleOption("loading")
        assertEquals(listOf("loading"), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.toggleOption("disconnected")
        assertEquals(listOf("loading", "disconnected"), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.toggleOption("loading")
        assertEquals(listOf("disconnected"), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.toggleOption("disconnected")
        assertEquals(emptyList<String>(), viewModel.state.visibleQuestion?.selectedValues)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)
    }

    @Test
    fun cancelQuestionPostsCancelPayloadAndRefreshesToLatestState() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-multi")
        viewModel.cancelQuestion(
            note = "No longer needed.",
            rationale = "The server already chose a default path."
        )
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedCancel("ask-multi", "No longer needed.", "The server already chose a default path.")),
            client.cancellations
        )
        assertEquals(2, client.fetchStateCalls)
        assertEquals(listOf("ask-single"), viewModel.state.pendingQuestions.map { it.requestId })
        assertEquals(QuestionTerminalState.CANCELLED, viewModel.state.visibleQuestion?.terminalState)
    }

    @Test
    fun cancelIsIgnoredWhileRequestIsInFlightAndDoesNotPostTwice() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val cancelMayComplete = CompletableDeferred<Unit>()
        client.beforeCancelCompletes = { cancelMayComplete.await() }
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-multi")
        viewModel.cancelQuestion(note = "No longer needed.")

        assertEquals(1, client.cancellations.size)
        assertTrue(viewModel.state.visibleQuestion?.isSubmitting ?: false)

        viewModel.cancelQuestion(note = "Second tap")

        assertEquals("second cancel while submitting must not post another cancel", 1, client.cancellations.size)

        cancelMayComplete.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, client.cancellations.size)
    }

    @Test
    fun alreadyResolvedAnswerConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.answerError = PostboxRequestAlreadyResolvedException(
            requestId = "ask-single",
            serverCode = "request_already_resolved",
            serverMessage = "Request ask-single is already resolved"
        )
        client.afterAnswer = {
            client.currentState = questionWorkflowState(
                requests = listOf(answeredSingleQuestion(), multiPendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.toggleOption("loopback")
        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(2, client.fetchStateCalls)
        assertEquals("ask-single", viewModel.state.visibleQuestion?.requestId)
        assertEquals(QuestionTerminalState.ALREADY_RESOLVED, viewModel.state.visibleQuestion?.terminalState)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)
        assertNotNull(viewModel.state.terminalMessage)
        assertEquals("ask-single", viewModel.state.terminalMessage?.requestId)
        assertTrue(viewModel.state.terminalMessage?.message?.contains("already resolved", ignoreCase = true) == true)
    }

    @Test
    fun alreadyResolvedCancelConflictRefreshesStateAndShowsTerminalMessageWithoutClearingQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.cancelError = PostboxRequestAlreadyResolvedException(
            requestId = "ask-multi",
            serverCode = "request_already_resolved",
            serverMessage = "Request ask-multi is already resolved"
        )
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-multi")
        viewModel.cancelQuestion()
        advanceUntilIdle()

        assertEquals(2, client.fetchStateCalls)
        assertEquals(listOf("ask-single"), viewModel.state.pendingQuestions.map { it.requestId })
        assertEquals("ask-multi", viewModel.state.visibleQuestion?.requestId)
        assertEquals(QuestionTerminalState.ALREADY_RESOLVED, viewModel.state.visibleQuestion?.terminalState)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)
        assertNotNull(viewModel.state.terminalMessage)
        assertEquals("ask-multi", viewModel.state.terminalMessage?.requestId)
        assertTrue(viewModel.state.terminalMessage?.message?.contains("already resolved", ignoreCase = true) == true)
    }

    @Test
    fun longQuestionAndContextRemainAvailableInVisibleQuestionState() = runTest {
        val longPrompt = "Should the native UI preserve every part of a long prompt? ".repeat(80)
        val longQuestionContext = "Question context line with setup and constraints.\n".repeat(120)
        val longProblemContext = "Problem context from the handoff should remain inspectable.\n".repeat(100)
        val longRichContext = "terminal output that explains the decision\n".repeat(160)
        val client = RecordingPostboxProtocolClient(
            questionWorkflowState(
                requests = listOf(
                    longContextQuestion(
                        longPrompt = longPrompt,
                        longQuestionContext = longQuestionContext,
                        longProblemContext = longProblemContext,
                        longRichContext = longRichContext
                    )
                )
            )
        )
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-long")
        val visibleQuestion = viewModel.state.visibleQuestion ?: error("Expected long question to remain visible")

        assertEquals(longPrompt, visibleQuestion.prompt)
        assertEquals(longQuestionContext, visibleQuestion.questionContext)
        assertEquals(longProblemContext, visibleQuestion.handoffContext?.problemContext)
        assertEquals(longRichContext, visibleQuestion.handoffContext?.additionalInfo?.single()?.content)
        assertTrue("Action state should still be exposed while long content scrolls", visibleQuestion.availableActions.contains(QuestionAction.SUBMIT))
        assertTrue(visibleQuestion.availableActions.contains(QuestionAction.CANCEL))
    }

    @Test
    fun fetchedBaselineAndSseSnapshotsNotifyOnlyForNewlyObservedPendingQuestions() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState(requests = emptyList()))
        val stream = FakePostboxStateStream()
        val postedNotifications = mutableListOf<PendingQuestionNotification>()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope,
            pendingQuestionNotificationTracker = PendingQuestionNotificationTracker(),
            onPendingQuestionNotifications = { notifications -> postedNotifications += notifications }
        )

        viewModel.start()
        advanceUntilIdle()
        assertEquals(
            "the initial fetched state is a visible baseline and should not notify",
            emptyList<PendingQuestionNotification>(),
            postedNotifications
        )

        val newQuestionState = questionWorkflowState(
            requests = listOf(singlePendingQuestion(requestId = "ask-from-sse", prompt = "Review the notification wiring?"))
        )
        stream.emit(PostboxStateStreamStatus.Connected(newQuestionState))
        advanceUntilIdle()

        assertEquals(listOf("ask-from-sse"), postedNotifications.map { it.requestId })
        assertEquals("Review the notification wiring?", postedNotifications.single().message)

        stream.emit(PostboxStateStreamStatus.Connected(newQuestionState))
        advanceUntilIdle()

        assertEquals(
            "replayed SSE state must not post a duplicate notification",
            listOf("ask-from-sse"),
            postedNotifications.map { it.requestId }
        )
    }

    @Test
    fun closingWorkflowStopsObservationSuppressesBackgroundNotificationsAndCanRestart() = runTest {
        val client = RecordingPostboxProtocolClient(
            questionWorkflowState(
                requests = listOf(singlePendingQuestion(requestId = "ask-background", prompt = "Background question"))
            )
        )
        val stream = FakePostboxStateStream()
        val fetchMayComplete = CompletableDeferred<Unit>()
        val postedNotifications = mutableListOf<PendingQuestionNotification>()
        client.beforeFetchCompletes = { fetchMayComplete.await() }
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope,
            pendingQuestionNotificationTracker = PendingQuestionNotificationTracker(),
            onPendingQuestionNotifications = { notifications -> postedNotifications += notifications }
        )

        viewModel.start()
        assertEquals(1, stream.startCount)
        assertEquals(1, client.fetchStateCalls)

        viewModel.close()
        fetchMayComplete.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, stream.closeCount)
        assertEquals(
            "state that arrives after the Activity stops must not post local notifications",
            emptyList<PendingQuestionNotification>(),
            postedNotifications
        )

        client.beforeFetchCompletes = null
        viewModel.start()
        advanceUntilIdle()

        assertEquals(2, stream.startCount)
        assertEquals(2, client.fetchStateCalls)

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-background", prompt = "Background question"),
                        singlePendingQuestion(requestId = "ask-active", prompt = "Foreground question")
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(
            "notifications resume only for questions observed while the workflow is active again",
            listOf("ask-active"),
            postedNotifications.map { it.requestId }
        )
    }

    @Test
    fun notificationTapSelectsRelevantQuestionWhenItIsStillPresent() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState(requests = emptyList()))
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )

        viewModel.start()
        advanceUntilIdle()
        viewModel.openQuestionFromNotification("ask-from-notification")

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-first"),
                        singlePendingQuestion(requestId = "ask-from-notification", prompt = "Open this tapped question")
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals("ask-from-notification", viewModel.state.visibleQuestion?.requestId)
        assertEquals("Open this tapped question", viewModel.state.visibleQuestion?.prompt)
    }

    @Test
    fun deniedNotificationPermissionIsShownWithoutBlockingQuestionWorkflow() = runTest {
        val viewModel = startedViewModel(
            RecordingPostboxProtocolClient(questionWorkflowState()),
            initialNotificationPermissionState = NotificationPermissionState.Denied
        )

        assertFalse(viewModel.state.isLoading)
        assertEquals(listOf("ask-single", "ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
        assertTrue(viewModel.state.notificationStatusMessage?.contains("disabled", ignoreCase = true) == true)

        viewModel.selectQuestion("ask-multi")
        assertEquals("ask-multi", viewModel.state.visibleQuestion?.requestId)
    }

    @Test
    fun disconnectedStreamStatePreservesCurrentlyVisibleQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )
        viewModel.start()
        advanceUntilIdle()
        viewModel.selectQuestion("ask-multi")
        viewModel.toggleOption("disconnected")
        val visibleBeforeDisconnect = viewModel.state.visibleQuestion

        stream.emit(PostboxStateStreamStatus.Disconnected(reason = "network down", latestState = null))
        advanceUntilIdle()

        assertEquals(QuestionConnectionState.DISCONNECTED, viewModel.state.connectionState)
        assertEquals("network down", viewModel.state.connectionMessage)
        assertEquals(visibleBeforeDisconnect?.requestId, viewModel.state.visibleQuestion?.requestId)
        assertEquals(visibleBeforeDisconnect?.prompt, viewModel.state.visibleQuestion?.prompt)
        assertEquals(listOf("disconnected"), viewModel.state.visibleQuestion?.selectedValues)
    }

    private suspend fun kotlinx.coroutines.test.TestScope.startedViewModel(
        client: RecordingPostboxProtocolClient,
        stream: FakePostboxStateStream = FakePostboxStateStream(),
        initialNotificationPermissionState: NotificationPermissionState = NotificationPermissionState.Granted
    ): QuestionWorkflowViewModel {
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope,
            initialNotificationPermissionState = initialNotificationPermissionState
        )
        viewModel.start()
        advanceUntilIdle()
        return viewModel
    }
}

private data class RecordedAnswer(
    val requestId: String,
    val selectedValues: List<String>,
    val note: String?,
    val rationale: String?
)

private data class RecordedCancel(
    val requestId: String,
    val note: String?,
    val rationale: String?
)

private class RecordingPostboxProtocolClient(
    var currentState: StateSnapshot
) : PostboxProtocolClient {
    var fetchStateCalls = 0
    val answers = mutableListOf<RecordedAnswer>()
    val cancellations = mutableListOf<RecordedCancel>()
    var beforeFetchCompletes: (suspend () -> Unit)? = null
    var beforeAnswerCompletes: (suspend () -> Unit)? = null
    var beforeCancelCompletes: (suspend () -> Unit)? = null
    var afterAnswer: (() -> Unit)? = null
    var afterCancel: (() -> Unit)? = null
    var answerError: PostboxRequestAlreadyResolvedException? = null
    var cancelError: PostboxRequestAlreadyResolvedException? = null

    override suspend fun fetchHealth(): HealthResponse = healthResponse()

    override suspend fun fetchState(): StateSnapshot {
        fetchStateCalls += 1
        beforeFetchCompletes?.invoke()
        return currentState
    }

    override suspend fun answerRequest(requestId: String, payload: AskAnswerPayload) {
        answers += RecordedAnswer(requestId, payload.selectedValues, payload.note, payload.rationale)
        beforeAnswerCompletes?.invoke()
        afterAnswer?.invoke()
        answerError?.let { throw it }
    }

    override suspend fun cancelRequest(requestId: String, payload: AskCancelPayload) {
        cancellations += RecordedCancel(requestId, payload.note, payload.rationale)
        beforeCancelCompletes?.invoke()
        afterCancel?.invoke()
        cancelError?.let { throw it }
    }
}

private class FakePostboxStateStream : PostboxStateStream {
    private val mutableStates = MutableSharedFlow<PostboxStateStreamStatus>(replay = 8)
    override val states: SharedFlow<PostboxStateStreamStatus> = mutableStates
    var startCount = 0
        private set
    var closeCount = 0
        private set

    override fun start() {
        startCount += 1
    }

    suspend fun emit(status: PostboxStateStreamStatus) {
        mutableStates.emit(status)
    }

    override fun close() {
        closeCount += 1
    }
}

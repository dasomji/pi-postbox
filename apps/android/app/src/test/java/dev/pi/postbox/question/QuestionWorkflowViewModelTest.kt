package dev.pi.postbox.question

import dev.pi.postbox.notification.NotificationPermissionState
import dev.pi.postbox.notification.PendingQuestionNotification
import dev.pi.postbox.notification.PendingQuestionNotificationTracker
import dev.pi.postbox.protocol.AskAnswerPayload
import dev.pi.postbox.protocol.AskCancelPayload
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.HealthResponse
import dev.pi.postbox.protocol.OTHER_OPTION_VALUE
import dev.pi.postbox.protocol.PostboxProtocolClient
import dev.pi.postbox.protocol.PresenceState
import dev.pi.postbox.protocol.PostboxRequestAlreadyResolvedException
import dev.pi.postbox.protocol.PostboxStateStream
import dev.pi.postbox.protocol.PostboxStateStreamStatus
import dev.pi.postbox.protocol.StateSnapshot
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
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
    fun sidebarDestinationsSelectQueueProjectSessionAndQuestion() = runTest {
        val viewModel = startedViewModel(RecordingPostboxProtocolClient(questionWorkflowState()))

        assertEquals(QuestionNavigationSelection.Question("ask-single"), viewModel.state.navigationSelection)

        viewModel.showQueue()
        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)

        viewModel.selectProject("session-live-project")
        assertEquals(
            QuestionNavigationSelection.Project("session-live-project"),
            viewModel.state.navigationSelection
        )

        viewModel.selectSession("session-live")
        assertEquals(QuestionNavigationSelection.Session("session-live"), viewModel.state.navigationSelection)

        viewModel.selectQuestion("ask-multi")
        assertEquals(QuestionNavigationSelection.Question("ask-multi"), viewModel.state.navigationSelection)
        assertEquals("ask-multi", viewModel.state.visibleQuestion?.requestId)
    }

    @Test
    fun projectSessionAndQuestionSelectionsSurviveLiveSnapshotUpdates() = runTest {
        val stream = FakePostboxStateStream()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            stream = stream
        )

        viewModel.selectProject("session-live-project")
        stream.emit(PostboxStateStreamStatus.Connected(questionWorkflowState()))
        advanceUntilIdle()
        assertEquals(
            QuestionNavigationSelection.Project("session-live-project"),
            viewModel.state.navigationSelection
        )

        viewModel.selectSession("session-live")
        stream.emit(PostboxStateStreamStatus.Connected(questionWorkflowState()))
        advanceUntilIdle()
        assertEquals(QuestionNavigationSelection.Session("session-live"), viewModel.state.navigationSelection)

        viewModel.selectQuestion("ask-multi")
        stream.emit(PostboxStateStreamStatus.Connected(questionWorkflowState()))
        advanceUntilIdle()
        assertEquals(QuestionNavigationSelection.Question("ask-multi"), viewModel.state.navigationSelection)
        assertEquals("ask-multi", viewModel.state.visibleQuestion?.requestId)
    }

    @Test
    fun hiddenProjectAndSessionDestinationsFallBackToQueue() = runTest {
        val freshState = questionWorkflowState()
        val staleState = freshState.copy(
            sessions = freshState.sessions.map { session ->
                if (session.sessionId == "session-live") {
                    session.copy(
                        presence = PresenceState.OFFLINE,
                        disconnectedAt = "2026-06-25T11:50:00.000Z"
                    )
                } else {
                    session
                }
            }
        )

        val sessionStream = FakePostboxStateStream()
        val sessionViewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(freshState),
            stream = sessionStream
        )
        sessionViewModel.selectSession("session-live")
        sessionStream.emit(PostboxStateStreamStatus.Connected(staleState))
        advanceUntilIdle()
        assertEquals(QuestionNavigationSelection.Queue, sessionViewModel.state.navigationSelection)

        val projectStream = FakePostboxStateStream()
        val projectViewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(freshState),
            stream = projectStream
        )
        projectViewModel.selectProject("session-live-project")
        projectStream.emit(PostboxStateStreamStatus.Connected(staleState))
        advanceUntilIdle()
        assertEquals(QuestionNavigationSelection.Queue, projectViewModel.state.navigationSelection)
    }

    @Test
    fun dismissingFromQueueProjectOrSessionPreservesCurrentDestination() = runTest {
        val destinations = listOf<Pair<(QuestionWorkflowViewModel) -> Unit, QuestionNavigationSelection>>(
            QuestionWorkflowViewModel::showQueue to QuestionNavigationSelection.Queue,
            ({ viewModel: QuestionWorkflowViewModel ->
                viewModel.selectProject("session-live-project")
            }) to QuestionNavigationSelection.Project("session-live-project"),
            ({ viewModel: QuestionWorkflowViewModel ->
                viewModel.selectSession("session-live")
            }) to QuestionNavigationSelection.Session("session-live")
        )

        destinations.forEach { (selectDestination, expectedSelection) ->
            val client = RecordingPostboxProtocolClient(questionWorkflowState())
            client.afterCancel = {
                client.currentState = questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(
                            status = AskStatus.CANCELLED,
                            resolvedAt = "2026-06-25T12:03:00.000Z"
                        ),
                        multiPendingQuestion()
                    )
                )
            }
            val viewModel = startedViewModel(client)

            selectDestination(viewModel)
            viewModel.dismissQuestion("ask-single")
            advanceUntilIdle()

            assertEquals(expectedSelection, viewModel.state.navigationSelection)
            assertEquals(listOf("ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
        }
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

        viewModel.submitAnswer(note = "Use emulator for this prototype.")
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedAnswer("ask-single", listOf("loopback"), "Use emulator for this prototype.")),
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
        viewModel.cancelQuestion(note = "No longer needed.")
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedCancel("ask-multi", "No longer needed.")),
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
    fun syntheticOtherSelectionSubmitsOtherValueWithNote() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterAnswer = {
            client.currentState = questionWorkflowState(
                requests = listOf(answeredSingleQuestion(), multiPendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.toggleOption(OTHER_OPTION_VALUE)
        assertEquals(listOf(OTHER_OPTION_VALUE), viewModel.state.visibleQuestion?.selectedValues)
        assertTrue(viewModel.state.visibleQuestion?.canSubmit ?: false)

        viewModel.submitAnswer(note = "None of the listed answers fit.")
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedAnswer("ask-single", listOf(OTHER_OPTION_VALUE), "None of the listed answers fit.")),
            client.answers
        )
    }

    @Test
    fun dismissQuestionCancelsByIdWithoutChangingVisibleQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertEquals(listOf("ask-multi"), client.cancellations.map { it.requestId })
        assertTrue(client.cancellations.single().note?.contains("Dismissed manually") == true)
        assertEquals(2, client.fetchStateCalls)
        assertEquals(listOf("ask-single"), viewModel.state.pendingQuestions.map { it.requestId })
        assertEquals("ask-single", viewModel.state.visibleQuestion?.requestId)
        assertNull(viewModel.state.dismissingRequestId)
        assertNull(viewModel.state.dismissError)
    }

    @Test
    fun dismissingTheVisibleQuestionMovesToTheNextPendingQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(
                    singlePendingQuestion(status = AskStatus.CANCELLED, resolvedAt = "2026-06-25T12:03:00.000Z"),
                    multiPendingQuestion()
                )
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.dismissQuestion("ask-single")
        advanceUntilIdle()

        assertEquals(listOf("ask-single"), client.cancellations.map { it.requestId })
        assertEquals(listOf("ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
        assertEquals("ask-multi", viewModel.state.visibleQuestion?.requestId)
    }

    @Test
    fun dismissIsIgnoredWhileAnotherDismissIsInFlight() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val cancelMayComplete = CompletableDeferred<Unit>()
        client.beforeCancelCompletes = { cancelMayComplete.await() }
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.dismissQuestion("ask-multi")
        assertEquals("ask-multi", viewModel.state.dismissingRequestId)

        viewModel.dismissQuestion("ask-single")

        assertEquals("second dismiss while one is in flight must not post another cancel", 1, client.cancellations.size)

        cancelMayComplete.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, client.cancellations.size)
    }

    @Test
    fun dismissFailureSurfacesDismissErrorAndKeepsQueue() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.cancelFailure = IOException("network down")
        val viewModel = startedViewModel(client)

        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertEquals("network down", viewModel.state.dismissError)
        assertNull(viewModel.state.dismissingRequestId)
        assertEquals(listOf("ask-single", "ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
        assertEquals("dismiss failure must not refetch state", 1, client.fetchStateCalls)
    }

    @Test
    fun alreadyResolvedDismissRefreshesQueueWithoutSurfacingAnError() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.cancelError = PostboxRequestAlreadyResolvedException(
            requestId = "ask-multi",
            serverCode = "request_already_resolved"
        )
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion(), cancelledMultiQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertNull(viewModel.state.dismissError)
        assertEquals(2, client.fetchStateCalls)
        assertEquals(listOf("ask-single"), viewModel.state.pendingQuestions.map { it.requestId })
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
    fun prefetchedSnapshotRendersImmediatelyWhileTheFirstFetchIsStillInFlight() = runTest {
        val fetchGate = CompletableDeferred<Unit>()
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.beforeFetchCompletes = { fetchGate.await() }
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = FakePostboxStateStream(),
            coroutineScope = backgroundScope,
            prefetchedSnapshotProvider = { baseUrl ->
                if (baseUrl == VERIFIED_BASE_URL) {
                    questionWorkflowState(
                        requests = listOf(singlePendingQuestion(requestId = "ask-prefetched", prompt = "Prefetched question"))
                    )
                } else {
                    null
                }
            }
        )

        viewModel.start()

        assertEquals(listOf("ask-prefetched"), viewModel.state.pendingQuestions.map { it.requestId })
        assertFalse(viewModel.state.isSyncing)
        assertFalse(viewModel.state.isLoading)

        fetchGate.complete(Unit)
        runCurrent()

        assertEquals(listOf("ask-single", "ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
    }

    @Test
    fun syncingFlagCoversTheWindowBetweenStartAndTheFirstSnapshot() = runTest {
        val fetchGate = CompletableDeferred<Unit>()
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.beforeFetchCompletes = { fetchGate.await() }
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = FakePostboxStateStream(),
            coroutineScope = backgroundScope
        )

        viewModel.start()
        assertTrue(viewModel.state.isSyncing)

        fetchGate.complete(Unit)
        runCurrent()
        assertFalse(viewModel.state.isSyncing)
    }

    @Test
    fun questionResolvedOnAnotherDeviceWhileOpenDisappearsToQueueWithMessage() = runTest {
        val stream = FakePostboxStateStream()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            stream = stream
        )
        viewModel.selectQuestion("ask-single")
        assertEquals(QuestionNavigationSelection.Question("ask-single"), viewModel.state.navigationSelection)

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-single", status = AskStatus.ANSWERED),
                        multiPendingQuestion()
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
        assertEquals("ask-single", viewModel.state.terminalMessage?.requestId)
        assertTrue(viewModel.state.terminalMessage?.message?.contains("another device") == true)
    }

    @Test
    fun questionCancelledElsewhereWhileOnQueueDoesNotHijackNavigation() = runTest {
        val stream = FakePostboxStateStream()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            stream = stream
        )
        viewModel.selectSession("session-live")

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-single", status = AskStatus.CANCELLED),
                        multiPendingQuestion()
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Session("session-live"), viewModel.state.navigationSelection)
        assertNull(viewModel.state.terminalMessage)
    }

    @Test
    fun notificationTapForAlreadyResolvedQuestionShowsQueue() = runTest {
        val viewModel = startedViewModel(
            RecordingPostboxProtocolClient(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-open"),
                        singlePendingQuestion(requestId = "ask-answered", status = AskStatus.ANSWERED)
                    )
                )
            )
        )

        viewModel.openQuestionFromNotification("ask-answered")

        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
    }

    @Test
    fun notificationTapWhoseQuestionArrivesResolvedShowsQueue() = runTest {
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
                        singlePendingQuestion(requestId = "ask-from-notification", status = AskStatus.ANSWERED)
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-first"),
                        singlePendingQuestion(requestId = "ask-from-notification", status = AskStatus.ANSWERED)
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(
            "a consumed stale notification tap must not re-trigger queue navigation on later snapshots",
            QuestionNavigationSelection.Queue,
            viewModel.state.navigationSelection
        )
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
    val note: String?
)

private data class RecordedCancel(
    val requestId: String,
    val note: String?
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
    var cancelFailure: IOException? = null

    override suspend fun fetchHealth(): HealthResponse = healthResponse()

    override suspend fun fetchState(): StateSnapshot {
        fetchStateCalls += 1
        beforeFetchCompletes?.invoke()
        return currentState
    }

    override suspend fun answerRequest(requestId: String, payload: AskAnswerPayload) {
        answers += RecordedAnswer(requestId, payload.selectedValues, payload.note)
        beforeAnswerCompletes?.invoke()
        afterAnswer?.invoke()
        answerError?.let { throw it }
    }

    override suspend fun cancelRequest(requestId: String, payload: AskCancelPayload) {
        cancellations += RecordedCancel(requestId, payload.note)
        beforeCancelCompletes?.invoke()
        cancelFailure?.let { throw it }
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

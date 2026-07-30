package dev.pi.postbox.question

import dev.pi.postbox.notification.NotificationPermissionState
import dev.pi.postbox.notification.PendingQuestionNotification
import dev.pi.postbox.notification.PendingQuestionNotificationTracker
import dev.pi.postbox.protocol.AskAnswerPayload
import dev.pi.postbox.protocol.AskCancelPayload
import dev.pi.postbox.protocol.AskOption
import dev.pi.postbox.protocol.AskOptionProvenance
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.AskUrgency
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
        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()

        val state = viewModel.state
        assertFalse(state.isLoading)
        assertEquals(VERIFIED_BASE_URL, state.baseUrl)
        assertEquals(QuestionConnectionState.CONNECTED, state.connectionState)
        assertEquals(1, stream.startCount)
        assertEquals(0, client.fetchStateCalls)
        assertEquals(listOf("session-live", "session-offline"), state.sessions.map { it.sessionId })
        assertEquals(listOf("ask-single", "ask-multi"), state.pendingQuestions.map { it.requestId })
        assertEquals("Choose one deployment target", state.pendingQuestions.first().prompt)
        assertEquals("ask-single", state.visibleQuestion?.requestId)
    }

    @Test
    fun authoritativeQuestionRestoresAndReconcilesItsPersistedAnswerDraft() = runTest {
        val draftStore = FakeQuestionDraftStore().apply {
            drafts[QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")] = QuestionAnswerDraft(
                selectedValues = listOf("loopback", "removed-option"),
                note = "Keep the emulator-only path."
            )
        }

        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        assertEquals(listOf("loopback"), viewModel.state.visibleQuestion?.selectedValues)
        assertEquals("Keep the emulator-only path.", viewModel.state.visibleQuestion?.note)
        assertEquals(
            listOf(QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")),
            draftStore.loadedKeys
        )
    }

    @Test
    fun restoredDraftIsSanitizedToIndependentBoundsAndQuestionOptions() = runTest {
        val options = (1..21).map { index ->
            AskOption(value = "option-$index", label = "Option $index")
        }
        val oversizedValue = "v".repeat(MAX_QUESTION_DRAFT_VALUE_CHARS + 1)
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-multi")
        val draftStore = FakeQuestionDraftStore().apply {
            drafts[key] = QuestionAnswerDraft(
                selectedValues = listOf(
                    "option-1",
                    "option-1",
                    "removed-option",
                    oversizedValue,
                    OTHER_OPTION_VALUE
                ) + options.drop(1).map { it.value },
                note = "n".repeat(MAX_QUESTION_DRAFT_NOTE_CHARS + 1)
            )
        }
        val expected = QuestionAnswerDraft(
            selectedValues = listOf("option-1", OTHER_OPTION_VALUE) +
                options.drop(1).take(MAX_QUESTION_DRAFT_SELECTED_VALUES - 2).map { it.value },
            note = "n".repeat(MAX_QUESTION_DRAFT_NOTE_CHARS)
        )
        val snapshot = questionWorkflowState(
            requests = listOf(
                multiPendingQuestion().copy(
                    options = options + AskOption(value = oversizedValue, label = "Oversized")
                )
            )
        )

        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(snapshot),
            draftStore = draftStore
        )

        assertEquals(expected.selectedValues, viewModel.state.visibleQuestion?.selectedValues)
        assertEquals(expected.note, viewModel.state.visibleQuestion?.note)
        assertEquals(expected, draftStore.drafts[key])
    }

    @Test
    fun selectionAndNoteEditsPersistAsOneIndependentAnswerDraft() = runTest {
        val draftStore = FakeQuestionDraftStore()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("Keep this note when the choice changes.")
        viewModel.toggleOption("tailnet")
        advanceUntilIdle()

        assertEquals(
            QuestionAnswerDraft(
                selectedValues = listOf("tailnet"),
                note = "Keep this note when the choice changes."
            ),
            draftStore.drafts[QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")]
        )
        assertEquals("Keep this note when the choice changes.", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun navigatingBetweenQuestionsRestoresEachIndependentInMemoryDraft() = runTest {
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = FakeQuestionDraftStore()
        )
        viewModel.updateNote("Single-question note")
        viewModel.toggleOption("tailnet")

        viewModel.selectQuestion("ask-multi")
        assertEquals("", viewModel.state.visibleQuestion?.note)
        viewModel.updateNote("Multi-question note")
        viewModel.toggleOption("loading")

        viewModel.selectQuestion("ask-single")

        assertEquals(listOf("tailnet"), viewModel.state.visibleQuestion?.selectedValues)
        assertEquals("Single-question note", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun optionRemovedByAuthoritativeSnapshotIsRemovedFromMemoryAndDurableDraft() = runTest {
        val stream = FakePostboxStateStream()
        val draftStore = FakeQuestionDraftStore()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            stream = stream,
            draftStore = draftStore
        )
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        viewModel.updateNote("Keep this note")
        viewModel.toggleOption("tailnet")
        advanceUntilIdle()

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion().copy(
                            options = listOf(AskOption(value = "loopback", label = "Loopback"))
                        ),
                        multiPendingQuestion()
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionAnswerDraft(note = "Keep this note"), draftStore.drafts[key])
        viewModel.selectQuestion("ask-multi")
        viewModel.selectQuestion("ask-single")
        assertEquals(emptyList<String>(), viewModel.state.visibleQuestion?.selectedValues)
        assertEquals("Keep this note", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun persistedNoteIsBoundedIndependentlyOfProtocolValidation() = runTest {
        val draftStore = FakeQuestionDraftStore()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("n".repeat(128_001))
        advanceUntilIdle()

        assertEquals(128_000, viewModel.state.visibleQuestion?.note?.length)
        assertEquals(
            128_000,
            draftStore.drafts[QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")]?.note?.length
        )
    }

    @Test
    fun persistedSelectionsAreBoundedIndependentlyOfProtocolValidation() = runTest {
        val options = (1..21).map { index ->
            AskOption(value = "option-$index", label = "Option $index")
        }
        val snapshot = questionWorkflowState(
            requests = listOf(multiPendingQuestion().copy(options = options))
        )
        val draftStore = FakeQuestionDraftStore()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(snapshot),
            draftStore = draftStore
        )

        options.forEach { option -> viewModel.toggleOption(option.value) }
        advanceUntilIdle()

        assertEquals(20, viewModel.state.visibleQuestion?.selectedValues?.size)
        assertEquals(
            options.take(20).map { it.value },
            draftStore.drafts[QuestionDraftKey(VERIFIED_BASE_URL, "ask-multi")]?.selectedValues
        )
    }

    @Test
    fun aLateDiskLoadCannotOverwriteNewerInMemoryEdits() = runTest {
        val loadMayComplete = CompletableDeferred<Unit>()
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val draftStore = FakeQuestionDraftStore().apply {
            drafts[key] = QuestionAnswerDraft(
                selectedValues = listOf("loopback"),
                note = "Older disk note"
            )
            beforeLoadCompletes = { loadMayComplete.await() }
        }
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("Newer in-memory note")
        viewModel.toggleOption("tailnet")
        loadMayComplete.complete(Unit)
        runCurrent()

        assertEquals(listOf("tailnet"), viewModel.state.visibleQuestion?.selectedValues)
        assertEquals("Newer in-memory note", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun newerDraftSaveAlwaysWinsWhenAnOlderWriteIsSlow() = runTest {
        val firstSaveMayComplete = CompletableDeferred<Unit>()
        var saveCalls = 0
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val draftStore = FakeQuestionDraftStore().apply {
            beforeSaveCompletes = { _, _ ->
                saveCalls += 1
                if (saveCalls == 1) firstSaveMayComplete.await()
            }
        }
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("Older edit")
        viewModel.updateNote("Newest edit")
        firstSaveMayComplete.complete(Unit)
        runCurrent()

        assertEquals("Newest edit", draftStore.drafts[key]?.note)
    }

    @Test
    fun failedSecureSaveKeepsEditsInMemoryAndRetryClearsTheWarning() = runTest {
        val draftStore = FakeQuestionDraftStore().apply {
            saveFailure = QuestionDraftStoreFailure.WRITE_FAILED
        }
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("Retain this private edit in memory")
        advanceUntilIdle()

        assertEquals("Retain this private edit in memory", viewModel.state.visibleQuestion?.note)
        assertEquals(
            "Secure storage failed. Your draft is kept only in this app session and will not survive an app restart.",
            viewModel.state.visibleQuestion?.draftPersistenceError
        )
        assertFalse(
            viewModel.state.visibleQuestion?.draftPersistenceError.orEmpty()
                .contains("Retain this private edit in memory")
        )

        draftStore.saveFailure = null
        viewModel.retryDraftSave()
        advanceUntilIdle()

        assertNull(viewModel.state.visibleQuestion?.draftPersistenceError)
        assertEquals(
            "Retain this private edit in memory",
            draftStore.drafts[QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")]?.note
        )
    }

    @Test
    fun saveFailureRemainsVisibleAfterNavigatingAwayAndBack() = runTest {
        val saveMayComplete = CompletableDeferred<Unit>()
        val draftStore = FakeQuestionDraftStore().apply {
            saveFailure = QuestionDraftStoreFailure.WRITE_FAILED
            beforeSaveCompletes = { key, _ ->
                if (key.requestId == "ask-single") saveMayComplete.await()
            }
        }
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        viewModel.updateNote("Current in-memory edit")
        viewModel.selectQuestion("ask-multi")
        saveMayComplete.complete(Unit)
        runCurrent()

        assertNull(viewModel.state.visibleQuestion?.draftPersistenceError)
        viewModel.selectQuestion("ask-single")
        assertNotNull(viewModel.state.visibleQuestion?.draftPersistenceError)
        assertEquals("Current in-memory edit", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun failedSecureLoadRetryReloadsWithoutOverwritingThePersistedDraft() = runTest {
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val persistedDraft = QuestionAnswerDraft(listOf("loopback"), "Persisted nuance")
        val draftStore = FakeQuestionDraftStore().apply {
            drafts[key] = persistedDraft
            loadFailure = QuestionDraftStoreFailure.READ_FAILED
        }
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            draftStore = draftStore
        )

        assertNotNull(viewModel.state.visibleQuestion?.draftPersistenceError)
        assertFalse(
            viewModel.state.visibleQuestion?.draftPersistenceError.orEmpty()
                .contains("READ_FAILED")
        )

        draftStore.loadFailure = null
        viewModel.retryDraftSave()
        advanceUntilIdle()

        assertNull(viewModel.state.visibleQuestion?.draftPersistenceError)
        assertEquals(2, draftStore.loadedKeys.count { it == key })
        assertEquals(persistedDraft, draftStore.drafts[key])
        assertEquals(persistedDraft.selectedValues, viewModel.state.visibleQuestion?.selectedValues)
        assertEquals(persistedDraft.note, viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun secureStorageFailureDoesNotBlockSubmittingTheCurrentInMemoryAnswer() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState()).apply {
            afterAnswer = {
                currentState = questionWorkflowState(requests = listOf(multiPendingQuestion()))
            }
        }
        val viewModel = startedViewModel(
            client = client,
            draftStore = FakeQuestionDraftStore().apply {
                saveFailure = QuestionDraftStoreFailure.WRITE_FAILED
            }
        )
        viewModel.updateNote("Submit from memory")
        viewModel.toggleOption("loopback")
        advanceUntilIdle()
        assertNotNull(viewModel.state.visibleQuestion?.draftPersistenceError)

        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedAnswer("ask-single", listOf("loopback"), "Submit from memory")),
            client.answers
        )
    }

    @Test
    fun secureStorageFailureDoesNotBlockCancellingWithTheCurrentInMemoryNote() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState()).apply {
            afterCancel = {
                currentState = questionWorkflowState(requests = listOf(multiPendingQuestion()))
            }
        }
        val viewModel = startedViewModel(
            client = client,
            draftStore = FakeQuestionDraftStore().apply {
                saveFailure = QuestionDraftStoreFailure.WRITE_FAILED
            }
        )
        viewModel.updateNote("Cancel from memory")
        advanceUntilIdle()
        assertNotNull(viewModel.state.visibleQuestion?.draftPersistenceError)

        viewModel.cancelQuestion()
        advanceUntilIdle()

        assertEquals(
            listOf(RecordedCancel("ask-single", "Cancel from memory")),
            client.cancellations
        )
        assertNull(viewModel.state.visibleQuestion?.draftPersistenceError)
    }

    @Test
    fun successfulAnswerDeletesItsPersistedDraft() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState()).apply {
            afterAnswer = {
                currentState = questionWorkflowState(requests = listOf(multiPendingQuestion()))
            }
        }
        val draftStore = FakeQuestionDraftStore()
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val viewModel = startedViewModel(client = client, draftStore = draftStore)
        viewModel.updateNote("Delete after success")
        viewModel.toggleOption("tailnet")
        advanceUntilIdle()
        assertNotNull(draftStore.drafts[key])

        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(listOf(key), draftStore.deletedKeys)
        assertNull(draftStore.drafts[key])
    }

    @Test
    fun successfulCancelDeletesItsPersistedDraft() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState()).apply {
            afterCancel = {
                currentState = questionWorkflowState(requests = listOf(multiPendingQuestion()))
            }
        }
        val draftStore = FakeQuestionDraftStore()
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val viewModel = startedViewModel(client = client, draftStore = draftStore)
        viewModel.updateNote("Delete after cancel")
        advanceUntilIdle()
        assertNotNull(draftStore.drafts[key])

        viewModel.cancelQuestion()
        advanceUntilIdle()

        assertEquals(listOf(key), draftStore.deletedKeys)
        assertNull(draftStore.drafts[key])
    }

    @Test
    fun successfulDismissDeletesTheDismissedQuestionsPersistedDraft() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState()).apply {
            afterCancel = {
                currentState = questionWorkflowState(requests = listOf(singlePendingQuestion()))
            }
        }
        val draftStore = FakeQuestionDraftStore()
        val key = QuestionDraftKey(VERIFIED_BASE_URL, "ask-multi")
        val viewModel = startedViewModel(client = client, draftStore = draftStore)
        viewModel.selectQuestion("ask-multi")
        viewModel.updateNote("Delete after dismiss")
        advanceUntilIdle()
        assertNotNull(draftStore.drafts[key])
        viewModel.selectQuestion("ask-single")

        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertEquals(listOf(key), draftStore.deletedKeys)
        assertNull(draftStore.drafts[key])
    }

    @Test
    fun authoritativeSnapshotReconcilesStoreAndDropsTerminalOrAbsentInMemoryDrafts() = runTest {
        val stream = FakePostboxStateStream()
        val draftStore = FakeQuestionDraftStore()
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState()),
            stream = stream,
            draftStore = draftStore
        )
        val staleKey = QuestionDraftKey(VERIFIED_BASE_URL, "ask-single")
        val terminalKey = QuestionDraftKey(VERIFIED_BASE_URL, "ask-terminal")
        val absentKey = QuestionDraftKey(VERIFIED_BASE_URL, "ask-absent")
        val otherServerKey = QuestionDraftKey("https://other.example.test", "ask-absent")
        viewModel.updateNote("Must not return")
        advanceUntilIdle()
        draftStore.drafts[terminalKey] = QuestionAnswerDraft(note = "terminal")
        draftStore.drafts[absentKey] = QuestionAnswerDraft(note = "absent")
        draftStore.drafts[otherServerKey] = QuestionAnswerDraft(note = "other server")

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(status = AskStatus.ANSWERED),
                        multiPendingQuestion(),
                        singlePendingQuestion(requestId = "ask-terminal", status = AskStatus.CANCELLED)
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(VERIFIED_BASE_URL, draftStore.reconcileCalls.last().first)
        assertEquals(setOf("ask-multi"), draftStore.reconcileCalls.last().second)
        assertNull(draftStore.drafts[staleKey])
        assertNull(draftStore.drafts[terminalKey])
        assertNull(draftStore.drafts[absentKey])
        assertNotNull(draftStore.drafts[otherServerKey])

        stream.emit(PostboxStateStreamStatus.Connected(questionWorkflowState()))
        advanceUntilIdle()
        viewModel.selectQuestion("ask-multi")
        viewModel.selectQuestion("ask-single")

        assertEquals("", viewModel.state.visibleQuestion?.note)
    }

    @Test
    fun manualRefreshFetchesOnceAndPreservesTheVisibleSelection() = runTest {
        val refreshMayComplete = CompletableDeferred<Unit>()
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val viewModel = startedViewModel(client)
        viewModel.selectQuestion("ask-single")
        viewModel.toggleOption("loopback")
        client.currentState = questionWorkflowState(
            requests = listOf(
                singlePendingQuestion(prompt = "Choose the refreshed deployment target"),
                multiPendingQuestion()
            )
        )
        client.beforeFetchCompletes = { refreshMayComplete.await() }

        viewModel.refreshQuestions()
        viewModel.refreshQuestions()
        runCurrent()

        assertTrue(viewModel.state.isRefreshing)
        assertTrue(viewModel.state.isSyncing)
        assertEquals(1, client.fetchStateCalls)

        refreshMayComplete.complete(Unit)
        runCurrent()

        assertFalse(viewModel.state.isRefreshing)
        assertFalse(viewModel.state.isSyncing)
        assertEquals("Choose the refreshed deployment target", viewModel.state.visibleQuestion?.prompt)
        assertEquals(listOf("loopback"), viewModel.state.visibleQuestion?.selectedValues)
    }

    @Test
    fun pendingQuestionsAndInitialSelectionPrioritizeUrgencyThenAgeDeterministically() = runTest {
        val requests = listOf(
            singlePendingQuestion(requestId = "low", prompt = "Low priority").copy(
                urgency = AskUrgency.LOW,
                createdAt = "2026-06-25T11:00:00.000Z"
            ),
            singlePendingQuestion(requestId = "high-new", prompt = "New high priority").copy(
                urgency = AskUrgency.HIGH,
                createdAt = "2026-06-25T11:30:00.000Z"
            ),
            singlePendingQuestion(requestId = "high-offset-old", prompt = "Offset high priority").copy(
                urgency = AskUrgency.HIGH,
                createdAt = "2026-06-25T12:00:00+02:00"
            ),
            singlePendingQuestion(requestId = "normal", prompt = "Normal priority").copy(
                urgency = AskUrgency.NORMAL,
                createdAt = "2026-06-25T10:00:00.000Z"
            ),
            singlePendingQuestion(requestId = "high-old", prompt = "Old high priority").copy(
                urgency = AskUrgency.HIGH,
                createdAt = "2026-06-25T11:00:00.000Z"
            ),
            singlePendingQuestion(requestId = "high-old-b", prompt = "Tied high priority").copy(
                urgency = AskUrgency.HIGH,
                createdAt = "2026-06-25T11:00:00.000Z"
            )
        )

        val viewModel = startedViewModel(RecordingPostboxProtocolClient(questionWorkflowState(requests)))

        assertEquals(
            listOf("high-offset-old", "high-old", "high-old-b", "high-new", "normal", "low"),
            viewModel.state.pendingQuestions.map { it.requestId }
        )
        assertEquals(QuestionUrgency.HIGH, viewModel.state.pendingQuestions.first().urgency)
        assertEquals("high-offset-old", viewModel.state.visibleQuestion?.requestId)
        assertEquals(QuestionUrgency.HIGH, viewModel.state.visibleQuestion?.urgency)
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
                client.currentState = questionWorkflowState(requests = listOf(multiPendingQuestion()))
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
                requests = listOf(multiPendingQuestion())
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
        assertEquals(1, client.fetchStateCalls)
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
                requests = listOf(multiPendingQuestion())
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
    fun liveOptionUpdatesPreserveValidSelectionsExposeRichFieldsAndDropRemovedValues() = runTest {
        val stream = FakePostboxStateStream()
        val richOption = AskOption(
            value = "tailnet",
            label = "Use Tailnet HTTPS",
            description = "Use the verified endpoint.",
            meaning = "Keep traffic inside the tailnet.",
            context = "The server has already passed its health check."
        )
        val initial = singlePendingQuestion().copy(options = listOf(richOption))
        val viewModel = startedViewModel(
            client = RecordingPostboxProtocolClient(questionWorkflowState(listOf(initial))),
            stream = stream
        )
        viewModel.toggleOption("tailnet")

        val suggested = AskOption(
            value = "chat_stage",
            label = "Stage first",
            provenance = AskOptionProvenance.CHAT
        )
        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(listOf(initial.copy(options = listOf(richOption, suggested))))
            )
        )
        advanceUntilIdle()

        val updated = viewModel.state.visibleQuestion ?: error("Expected updated question")
        assertEquals(listOf("tailnet"), updated.selectedValues)
        assertEquals("Use the verified endpoint.", updated.options.first().description)
        assertEquals("Keep traffic inside the tailnet.", updated.options.first().meaning)
        assertEquals("The server has already passed its health check.", updated.options.first().context)
        assertEquals(QuestionOptionProvenance.CHAT, updated.options.last().provenance)

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(listOf(initial.copy(options = listOf(suggested))))
            )
        )
        advanceUntilIdle()

        assertEquals(emptyList<String>(), viewModel.state.visibleQuestion?.selectedValues)
        assertFalse(viewModel.state.visibleQuestion?.canSubmit ?: true)
    }

    @Test
    fun cancelQuestionPostsCancelPayloadAndRefreshesToLatestState() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        client.afterCancel = {
            client.currentState = questionWorkflowState(
                requests = listOf(singlePendingQuestion())
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
        assertEquals(1, client.fetchStateCalls)
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
                requests = listOf(singlePendingQuestion())
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
                requests = listOf(multiPendingQuestion())
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
                requests = listOf(singlePendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertEquals(listOf("ask-multi"), client.cancellations.map { it.requestId })
        assertTrue(client.cancellations.single().note?.contains("Dismissed manually") == true)
        assertEquals(1, client.fetchStateCalls)
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
                requests = listOf(multiPendingQuestion())
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
                requests = listOf(singlePendingQuestion())
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
        assertEquals("dismiss failure must not refetch state", 0, client.fetchStateCalls)
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
                requests = listOf(singlePendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.dismissQuestion("ask-multi")
        advanceUntilIdle()

        assertNull(viewModel.state.dismissError)
        assertEquals(1, client.fetchStateCalls)
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
                requests = listOf(multiPendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-single")
        viewModel.toggleOption("loopback")
        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(1, client.fetchStateCalls)
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
                requests = listOf(singlePendingQuestion())
            )
        }
        val viewModel = startedViewModel(client)

        viewModel.selectQuestion("ask-multi")
        viewModel.cancelQuestion()
        advanceUntilIdle()

        assertEquals(1, client.fetchStateCalls)
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
        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()
        assertEquals(
            "the initial streamed state is a visible baseline and should not notify",
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
        assertEquals(1, stream.startCount)
        viewModel.close()
        advanceUntilIdle()

        assertEquals(1, stream.closeCount)
        assertEquals(emptyList<PendingQuestionNotification>(), postedNotifications)

        viewModel.start()
        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(singlePendingQuestion(requestId = "ask-background", prompt = "Background question"))
                )
            )
        )
        advanceUntilIdle()

        assertEquals(2, stream.startCount)
        assertEquals(0, client.fetchStateCalls)
        assertEquals(
            "the first snapshot after restart is a baseline and must not notify",
            emptyList<PendingQuestionNotification>(),
            postedNotifications
        )

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
    fun coldNotificationTapSharesTheInitialAuthoritativeStreamSnapshot() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState(requests = emptyList()))
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )

        viewModel.start()
        viewModel.openQuestionFromNotification("ask-from-notification")
        advanceUntilIdle()

        assertEquals(0, client.fetchStateCalls)
        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
        assertTrue(viewModel.state.isSyncing)

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
    fun notificationTapSelectsRelevantQuestionWhenItIsStillPresent() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState(requests = emptyList()))
        val viewModel = startedViewModel(client)
        client.currentState = questionWorkflowState(
            requests = listOf(
                singlePendingQuestion(requestId = "ask-first"),
                singlePendingQuestion(requestId = "ask-from-notification", prompt = "Open this tapped question")
            )
        )

        viewModel.openQuestionFromNotification("ask-from-notification")
        advanceUntilIdle()

        assertEquals(1, client.fetchStateCalls)
        assertEquals("ask-from-notification", viewModel.state.visibleQuestion?.requestId)
        assertEquals("Open this tapped question", viewModel.state.visibleQuestion?.prompt)
    }

    @Test
    fun prefetchedSnapshotRendersImmediatelyWhileTheInitialStreamSnapshotIsInFlight() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
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
        assertEquals(0, client.fetchStateCalls)

        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()

        assertEquals(listOf("ask-single", "ask-multi"), viewModel.state.pendingQuestions.map { it.requestId })
    }

    @Test
    fun syncingFlagCoversTheWindowBetweenStartAndTheFirstSnapshot() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState())
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )

        viewModel.start()
        assertTrue(viewModel.state.isSyncing)
        assertEquals(0, client.fetchStateCalls)

        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
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
                questionWorkflowState(requests = listOf(multiPendingQuestion()))
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
                questionWorkflowState(requests = listOf(multiPendingQuestion()))
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Session("session-live"), viewModel.state.navigationSelection)
        assertNull(viewModel.state.terminalMessage)
    }

    @Test
    fun notificationTapForAbsentQuestionShowsQueueWithoutOpeningAnotherPendingQuestion() = runTest {
        val client = RecordingPostboxProtocolClient(
            questionWorkflowState(requests = listOf(singlePendingQuestion(requestId = "ask-open")))
        )
        val viewModel = startedViewModel(client)

        viewModel.openQuestionFromNotification("ask-answered")
        advanceUntilIdle()

        assertEquals(1, client.fetchStateCalls)
        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
        assertNull(viewModel.state.visibleQuestion)
    }

    @Test
    fun notificationTapRefreshesBeforeOpeningAQuestionFromAStaleWarmSnapshot() = runTest {
        val client = RecordingPostboxProtocolClient(
            questionWorkflowState(requests = listOf(singlePendingQuestion(requestId = "ask-from-notification")))
        )
        val viewModel = startedViewModel(client)
        viewModel.selectQuestion("ask-from-notification")
        client.currentState = questionWorkflowState(
            requests = listOf(singlePendingQuestion(requestId = "ask-unrelated"))
        )

        viewModel.openQuestionFromNotification("ask-from-notification")
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
        assertEquals(1, client.fetchStateCalls)
        assertEquals(listOf("ask-unrelated"), viewModel.state.pendingQuestions.map { it.requestId })
        assertNull(viewModel.state.visibleQuestion)
    }

    @Test
    fun applyingStateReconcilesAndroidNotificationsAgainstPendingQuestionIds() = runTest {
        val reconciledPendingIds = mutableListOf<Set<String>>()
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = RecordingPostboxProtocolClient(questionWorkflowState()),
            stateStream = stream,
            coroutineScope = backgroundScope,
            onPendingRequestIdsObserved = { reconciledPendingIds += it }
        )

        viewModel.start()
        stream.emit(PostboxStateStreamStatus.Connected(questionWorkflowState()))
        advanceUntilIdle()

        stream.emit(
            PostboxStateStreamStatus.Connected(
                questionWorkflowState(
                    requests = listOf(
                        singlePendingQuestion(requestId = "ask-still-pending"),
                        singlePendingQuestion(requestId = "ask-answered", status = AskStatus.ANSWERED)
                    )
                )
            )
        )
        advanceUntilIdle()

        assertEquals(setOf("ask-still-pending"), reconciledPendingIds.last())
    }

    @Test
    fun notificationTapWhoseQuestionDisappearedIsConsumedOnce() = runTest {
        val client = RecordingPostboxProtocolClient(questionWorkflowState(requests = emptyList()))
        val stream = FakePostboxStateStream()
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope
        )

        viewModel.start()
        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()
        client.currentState = questionWorkflowState(
            requests = listOf(singlePendingQuestion(requestId = "ask-first"))
        )
        viewModel.openQuestionFromNotification("ask-from-notification")
        advanceUntilIdle()

        assertEquals(QuestionNavigationSelection.Queue, viewModel.state.navigationSelection)
        assertNull(viewModel.state.visibleQuestion)

        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
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
        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
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
        initialNotificationPermissionState: NotificationPermissionState = NotificationPermissionState.Granted,
        draftStore: QuestionDraftStore = NoopQuestionDraftStore
    ): QuestionWorkflowViewModel {
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stream,
            coroutineScope = backgroundScope,
            initialNotificationPermissionState = initialNotificationPermissionState,
            draftStore = draftStore
        )
        viewModel.start()
        stream.emit(PostboxStateStreamStatus.Connected(client.currentState))
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

private class FakeQuestionDraftStore : QuestionDraftStore {
    val drafts = linkedMapOf<QuestionDraftKey, QuestionAnswerDraft>()
    val loadedKeys = mutableListOf<QuestionDraftKey>()
    val deletedKeys = mutableListOf<QuestionDraftKey>()
    val reconcileCalls = mutableListOf<Pair<String, Set<String>>>()
    var beforeLoadCompletes: (suspend () -> Unit)? = null
    var beforeSaveCompletes: (suspend (QuestionDraftKey, QuestionAnswerDraft) -> Unit)? = null
    var loadFailure: QuestionDraftStoreFailure? = null
    var saveFailure: QuestionDraftStoreFailure? = null

    override suspend fun load(key: QuestionDraftKey): QuestionDraftStoreResult<QuestionAnswerDraft?> {
        loadedKeys += key
        val loadedDraft = drafts[key]
        beforeLoadCompletes?.invoke()
        loadFailure?.let { return QuestionDraftStoreResult.Failure(it) }
        return QuestionDraftStoreResult.Success(loadedDraft)
    }

    override suspend fun save(
        key: QuestionDraftKey,
        draft: QuestionAnswerDraft
    ): QuestionDraftStoreResult<Unit> {
        beforeSaveCompletes?.invoke(key, draft)
        saveFailure?.let { return QuestionDraftStoreResult.Failure(it) }
        drafts[key] = draft
        return QuestionDraftStoreResult.Success(Unit)
    }

    override suspend fun delete(key: QuestionDraftKey): QuestionDraftStoreResult<Unit> {
        deletedKeys += key
        drafts.remove(key)
        return QuestionDraftStoreResult.Success(Unit)
    }

    override suspend fun reconcileServer(
        normalizedServerUrl: String,
        activeRequestIds: Set<String>
    ): QuestionDraftStoreResult<Unit> {
        reconcileCalls += normalizedServerUrl to activeRequestIds.toSet()
        drafts.keys.removeAll { key ->
            key.normalizedServerUrl == normalizedServerUrl && key.requestId !in activeRequestIds
        }
        return QuestionDraftStoreResult.Success(Unit)
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

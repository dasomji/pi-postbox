package dev.pi.postbox.question

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.unit.dp
import dev.pi.postbox.questionchat.QuestionChatActivationUiState
import dev.pi.postbox.questionchat.QuestionChatBindingKey
import dev.pi.postbox.questionchat.QuestionChatConnectionState
import dev.pi.postbox.questionchat.QuestionChatContextFallbackAvailability
import dev.pi.postbox.questionchat.QuestionChatAvailabilityCode
import dev.pi.postbox.questionchat.QuestionChatAvailabilityError
import dev.pi.postbox.questionchat.QuestionChatForkKind
import dev.pi.postbox.questionchat.QuestionChatMessage
import dev.pi.postbox.questionchat.QuestionChatModel
import dev.pi.postbox.questionchat.QuestionChatModelSource
import dev.pi.postbox.questionchat.QuestionChatOwnerState
import dev.pi.postbox.questionchat.QuestionChatSessionUiState
import dev.pi.postbox.questionchat.QuestionChatSnapshot
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.QuestionChatToolActivity
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.ui.theme.PostboxTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class QuestionWorkflowScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun questionDetailShowsUrgencyRichOptionFieldsAndChatProvenanceAccessibly() {
        var toggledValue: String? = null
        val question = QuestionDetailUiState(
            requestId = "ask-high",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            urgency = QuestionUrgency.HIGH,
            prompt = "Choose a storage strategy",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(
                QuestionOptionUiState(
                    value = "sqlite",
                    label = "SQLite",
                    description = "Keep deployment self-contained.",
                    meaning = "Persist decisions beside session state.",
                    context = "No second service is required."
                ),
                QuestionOptionUiState(
                    value = "chat_stage",
                    label = "Stage first",
                    description = null,
                    provenance = QuestionOptionProvenance.CHAT
                )
            ),
            handoffContext = null,
            forkReference = null,
            selectedValues = listOf("sqlite"),
            canSubmit = true,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )

        setQuestionScreen(
            stateProvider = {
                QuestionWorkflowState(
                    baseUrl = "https://postbox.example/",
                    isLoading = false,
                    isSyncing = false,
                    connectionState = QuestionConnectionState.CONNECTED,
                    pendingQuestions = listOf(
                        QuestionListItemUiState(
                            requestId = question.requestId,
                            sessionId = question.sessionId,
                            prompt = question.prompt,
                            mode = question.mode,
                            createdAt = "2026-07-29T10:00:00.000Z",
                            expiresAt = null,
                            urgency = question.urgency
                        )
                    ),
                    visibleQuestion = question,
                    navigationSelection = QuestionNavigationSelection.Question(question.requestId)
                )
            },
            onToggleOption = { toggledValue = it }
        )

        composeRule.onNode(
            hasText("High urgency", substring = true) and
                hasContentDescription("Question detail priority: High urgency")
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Keep deployment self-contained.").assertIsDisplayed()
        composeRule.onNodeWithText("Meaning: Persist decisions beside session state.").assertIsDisplayed()
        composeRule.onNodeWithText("Context: No second service is required.").assertIsDisplayed()
        composeRule.onNodeWithText("Suggested in Chat").assertIsDisplayed()

        composeRule.onNode(hasText("SQLite", substring = true) and hasClickAction()).assertIsSelected()
        composeRule.onNode(
            hasText("Stage first", substring = true) and
                hasText("Suggested in Chat", substring = true) and
                hasClickAction()
        )
            .assertIsNotSelected()
            .performClick()
        assertEquals("chat_stage", toggledValue)
    }

    @Test
    fun liveOptionAppendPreservesTheNoteDraftAndExistingSelection() {
        val initialQuestion = QuestionDetailUiState(
            requestId = "ask-live",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a release path",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship now", null)),
            handoffContext = null,
            forkReference = null,
            selectedValues = listOf("ship"),
            canSubmit = true,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        val screenState = mutableStateOf(
            QuestionWorkflowState(
                baseUrl = "https://postbox.example/",
                isLoading = false,
                isSyncing = false,
                connectionState = QuestionConnectionState.CONNECTED,
                pendingQuestions = listOf(
                    QuestionListItemUiState(
                        requestId = initialQuestion.requestId,
                        sessionId = initialQuestion.sessionId,
                        prompt = initialQuestion.prompt,
                        mode = initialQuestion.mode,
                        createdAt = "2026-07-29T10:00:00.000Z",
                        expiresAt = null
                    )
                ),
                visibleQuestion = initialQuestion,
                navigationSelection = QuestionNavigationSelection.Question(initialQuestion.requestId)
            )
        )

        setQuestionScreen(
            stateProvider = { screenState.value },
            onNoteChanged = { note ->
                screenState.value = screenState.value.copy(
                    visibleQuestion = screenState.value.visibleQuestion?.copy(note = note)
                )
            }
        )

        composeRule.onNodeWithText("+ Add a note").performClick()
        composeRule.onNode(hasSetTextAction()).performTextInput("Keep my draft")

        composeRule.runOnUiThread {
            val currentQuestion = screenState.value.visibleQuestion ?: error("Expected visible question")
            screenState.value = screenState.value.copy(
                visibleQuestion = currentQuestion.copy(
                    options = currentQuestion.options + QuestionOptionUiState(
                        value = "chat_stage",
                        label = "Stage first",
                        description = null,
                        provenance = QuestionOptionProvenance.CHAT
                    )
                )
            )
        }

        composeRule.onNode(hasSetTextAction()).assert(hasText("Keep my draft"))
        composeRule.onNode(hasText("Ship now", substring = true) and hasClickAction()).assertIsSelected()
        composeRule.onNode(hasText("Stage first", substring = true) and hasClickAction()).assertIsNotSelected()
    }

    @Test
    fun restoredStateOwnedNoteIsRevealedAndEditsAreForwarded() {
        val initialQuestion = QuestionDetailUiState(
            requestId = "ask-restored-note",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a release path",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship now", null)),
            handoffContext = null,
            forkReference = null,
            selectedValues = listOf("ship"),
            note = "Restored secure note",
            canSubmit = true,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        val screenState = mutableStateOf(questionScreenState(initialQuestion))
        var forwardedNote: String? = null

        setQuestionScreen(
            stateProvider = { screenState.value },
            onNoteChanged = { note ->
                forwardedNote = note
                screenState.value = screenState.value.copy(
                    visibleQuestion = screenState.value.visibleQuestion?.copy(note = note)
                )
            }
        )

        composeRule.onNode(hasSetTextAction()).assert(hasText("Restored secure note"))
        composeRule.onNode(hasSetTextAction()).performTextReplacement("Edited secure note")
        composeRule.runOnIdle { assertEquals("Edited secure note", forwardedNote) }
    }

    @Test
    fun draftPersistenceWarningOffersRetryWithoutShowingDraftContent() {
        val privateNote = "private draft words"
        val question = QuestionDetailUiState(
            requestId = "ask-storage-warning",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a release path",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship now", null)),
            handoffContext = null,
            forkReference = null,
            selectedValues = listOf("ship"),
            note = privateNote,
            canSubmit = true,
            draftPersistenceError = "Secure storage failed. Your draft is kept only in this app session and will not survive an app restart.",
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        var retries = 0

        setQuestionScreen(
            stateProvider = { questionScreenState(question) },
            onRetryDraftSave = { retries += 1 }
        )

        composeRule.onNodeWithText("Secure storage failed. Your draft is kept only in this app session and will not survive an app restart.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, retries) }
    }

    @Test
    fun pendingQuestionShowsStartQuestionChatEntryAndStartsWhenTapped() {
        val question = QuestionDetailUiState(
            requestId = "ask-chat-start",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a deployment target",
            questionContext = "Need a mobile-safe choice.",
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship", null)),
            handoffContext = null,
            forkReference = null,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        var starts = 0

        setQuestionScreen(
            stateProvider = {
                questionScreenState(question).copy(
                    questionChat = questionChatWorkflowState(
                        key = QuestionChatBindingKey("https://postbox.example/", question.requestId)
                    )
                )
            },
            onStartQuestionChat = { starts += 1 }
        )

        composeRule.onNodeWithText("Start Question Chat").performScrollTo().assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Question Chat is temporary and first tries an exact fork of the asking Pi session.")
            .performScrollTo()
            .assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(1, starts) }
    }

    @Test
    fun exactForkFailureRequiresExplicitContextOnlyConfirmation() {
        val question = QuestionDetailUiState(
            requestId = "ask-context-fallback",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a deployment target",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship", null)),
            handoffContext = null,
            forkReference = null,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        var confirms = 0

        setQuestionScreen(
            stateProvider = {
                questionScreenState(question).copy(
                    questionChat = questionChatWorkflowState(
                        key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                        owner = QuestionChatOwnerState(
                            key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                            activation = QuestionChatActivationUiState.AwaitingContextFallbackConfirmation(
                                QuestionChatAvailabilityError(
                                    code = QuestionChatAvailabilityCode.SOURCE_LEAF_MISSING,
                                    message = "The recorded source leaf is unavailable.",
                                    contextFallback = QuestionChatContextFallbackAvailability.Available
                                )
                            )
                        )
                    )
                )
            },
            onConfirmContextOnlyQuestionChat = { confirms += 1 }
        )

        composeRule.onNodeWithText("Consider context-only interviewer").performScrollTo().assertIsDisplayed().performClick()
        composeRule.onNodeWithText("A context-only interviewer starts fresh from the persisted question and handoff context.")
            .assertIsDisplayed()
        composeRule.onNode(hasText("Start context-only interviewer") and hasClickAction()).performClick()
        composeRule.runOnIdle { assertEquals(1, confirms) }
    }

    @Test
    fun activatedQuestionChatShowsTabsStartersAndComposerCallbacks() {
        val question = QuestionDetailUiState(
            requestId = "ask-chat-ready",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a deployment target",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship", null)),
            handoffContext = null,
            forkReference = null,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )
        var selectedTab: QuestionChatWorkspaceTab? = null
        var sentDrafts = 0
        var starter: String? = null

        setQuestionScreen(
            stateProvider = {
                questionScreenState(question).copy(
                    questionChat = questionChatWorkflowState(
                        key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                        tabsVisible = true,
                        selectedTab = QuestionChatWorkspaceTab.CHAT,
                        owner = QuestionChatOwnerState(
                            key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                            knownStarted = true,
                            draftText = "Explain this",
                            session = QuestionChatSessionUiState(
                                snapshot = QuestionChatSnapshot(
                                    requestId = question.requestId,
                                    state = QuestionChatState.READY,
                                    forkKind = QuestionChatForkKind.EXACT,
                                    model = QuestionChatModel(
                                        id = "anthropic/claude-sonnet-4",
                                        source = QuestionChatModelSource.ORIGINATING
                                    ),
                                    sequence = 0,
                                    messages = emptyList(),
                                    tools = emptyList()
                                ),
                                connection = QuestionChatConnectionState.ONLINE
                            )
                        )
                    )
                )
            },
            onSelectQuestionChatTab = { selectedTab = it },
            onQuestionChatDraftChanged = {},
            onSendQuestionChatDraft = { sentDrafts += 1 },
            onSendQuestionChatStarter = { starter = it.name }
        )

        composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_CHAT_TAB_TEST_TAG).assertIsSelected()
        composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_QUESTION_TAB_TEST_TAG).assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(QuestionChatWorkspaceTab.QUESTION, selectedTab) }

        composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_CHAT_TAB_TEST_TAG).performClick()
        composeRule.onNodeWithText("Elaborate").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("ELABORATE", starter) }
        composeRule.onNodeWithText("Send").performClick()
        composeRule.runOnIdle { assertEquals(1, sentDrafts) }
    }

    @Test
    fun activatedQuestionChatPinsWorkspaceTabsNearTheBottomEdge() {
        val question = QuestionDetailUiState(
            requestId = "ask-chat-bottom-tabs",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
            prompt = "Choose a deployment target",
            questionContext = null,
            relevance = null,
            decisionImpact = null,
            options = listOf(QuestionOptionUiState("ship", "Ship", null)),
            handoffContext = null,
            forkReference = null,
            availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
        )

        setQuestionScreen(
            stateProvider = {
                questionScreenState(question).copy(
                    questionChat = questionChatWorkflowState(
                        key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                        tabsVisible = true,
                        selectedTab = QuestionChatWorkspaceTab.CHAT,
                        owner = QuestionChatOwnerState(
                            key = QuestionChatBindingKey("https://postbox.example/", question.requestId),
                            knownStarted = true,
                            session = QuestionChatSessionUiState(
                                snapshot = QuestionChatSnapshot(
                                    requestId = question.requestId,
                                    state = QuestionChatState.READY,
                                    forkKind = QuestionChatForkKind.EXACT,
                                    model = QuestionChatModel(
                                        id = "anthropic/claude-sonnet-4",
                                        source = QuestionChatModelSource.ORIGINATING
                                    ),
                                    sequence = 0,
                                    messages = emptyList(),
                                    tools = emptyList()
                                ),
                                connection = QuestionChatConnectionState.ONLINE
                            )
                        )
                    )
                )
            }
        )

        composeRule.waitForIdle()

        val rootBottom = composeRule.onRoot().fetchSemanticsNode().boundsInRoot.bottom
        val tabBottom = composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_CHAT_TAB_TEST_TAG).fetchSemanticsNode().boundsInRoot.bottom
        val maxDistanceFromBottom = with(composeRule.density) { 140.dp.toPx() }
        assertTrue(rootBottom - tabBottom < maxDistanceFromBottom)
    }

    @Test
    fun pullingDownFromTheQueueRequestsOneRefresh() {
        var refreshRequests = 0
        setQuestionScreen(
            stateProvider = {
                QuestionWorkflowState(
                    baseUrl = "https://postbox.example/",
                    isLoading = false,
                    isSyncing = false,
                    connectionState = QuestionConnectionState.CONNECTED,
                    pendingQuestions = listOf(question("normal", QuestionUrgency.NORMAL)),
                    navigationSelection = QuestionNavigationSelection.Queue
                )
            },
            onRefresh = { refreshRequests += 1 }
        )

        composeRule.onNodeWithTag(QUESTION_PULL_REFRESH_TEST_TAG)
            .performTouchInput { swipeDown() }

        composeRule.runOnIdle { assertEquals(1, refreshRequests) }
    }

    @Test
    fun queueShowsEveryUrgencyLevel() {
        setQuestionScreen(
            stateProvider = {
                QuestionWorkflowState(
                    baseUrl = "https://postbox.example/",
                    isLoading = false,
                    isSyncing = false,
                    connectionState = QuestionConnectionState.CONNECTED,
                    pendingQuestions = listOf(
                        question("high", QuestionUrgency.HIGH),
                        question("normal", QuestionUrgency.NORMAL),
                        question("low", QuestionUrgency.LOW)
                    ),
                    navigationSelection = QuestionNavigationSelection.Queue
                )
            }
        )

        listOf("High urgency", "Normal urgency", "Low urgency").forEach { urgencyLabel ->
            composeRule.onNode(
                hasTestTag(QUESTION_QUEUE_TEST_TAG) and
                    hasAnyDescendant(hasText(urgencyLabel, substring = true)) and
                    hasAnyDescendant(
                        hasContentDescription("Question priority: $urgencyLabel", substring = true)
                    )
            ).assertIsDisplayed()
        }
    }

    private fun setQuestionScreen(
        stateProvider: () -> QuestionWorkflowState,
        onToggleOption: (String) -> Unit = {},
        onNoteChanged: (String) -> Unit = {},
        onRetryDraftSave: () -> Unit = {},
        onRefresh: () -> Unit = {},
        onStartQuestionChat: () -> Unit = {},
        onConfirmContextOnlyQuestionChat: () -> Unit = {},
        onRetryQuestionChat: () -> Unit = {},
        onSelectQuestionChatTab: (QuestionChatWorkspaceTab) -> Unit = {},
        onQuestionChatDraftChanged: (String) -> Unit = {},
        onSendQuestionChatDraft: () -> Unit = {},
        onSendQuestionChatStarter: (dev.pi.postbox.questionchat.QuestionChatStarter) -> Unit = {},
        onStopQuestionChat: () -> Unit = {},
        onReviewQuestionChatSuggestion: (String) -> Unit = {}
    ) {
        composeRule.setContent {
            PostboxTheme {
                QuestionWorkflowScreen(
                    state = stateProvider(),
                    onShowQueue = {},
                    onSelectProject = {},
                    onSelectSession = {},
                    onSelectQuestion = {},
                    onToggleOption = onToggleOption,
                    onNoteChanged = onNoteChanged,
                    onRetryDraftSave = onRetryDraftSave,
                    onSubmitAnswer = {},
                    onCancelQuestion = {},
                    onDismissQuestion = {},
                    onEditServerUrl = {},
                    onRefresh = onRefresh,
                    onStartQuestionChat = onStartQuestionChat,
                    onConfirmContextOnlyQuestionChat = onConfirmContextOnlyQuestionChat,
                    onRetryQuestionChat = onRetryQuestionChat,
                    onSelectQuestionChatTab = onSelectQuestionChatTab,
                    onQuestionChatDraftChanged = onQuestionChatDraftChanged,
                    onSendQuestionChatDraft = onSendQuestionChatDraft,
                    onSendQuestionChatStarter = onSendQuestionChatStarter,
                    onStopQuestionChat = onStopQuestionChat,
                    onReviewQuestionChatSuggestion = onReviewQuestionChatSuggestion,
                    onHandleBack = { false }
                )
            }
        }
    }

    private fun questionScreenState(question: QuestionDetailUiState) = QuestionWorkflowState(
        baseUrl = "https://postbox.example/",
        isLoading = false,
        isSyncing = false,
        connectionState = QuestionConnectionState.CONNECTED,
        pendingQuestions = listOf(
            QuestionListItemUiState(
                requestId = question.requestId,
                sessionId = question.sessionId,
                prompt = question.prompt,
                mode = question.mode,
                createdAt = "2026-07-29T10:00:00.000Z",
                expiresAt = null,
                urgency = question.urgency
            )
        ),
        visibleQuestion = question,
        navigationSelection = QuestionNavigationSelection.Question(question.requestId)
    )

    private fun question(requestId: String, urgency: QuestionUrgency) = QuestionListItemUiState(
        requestId = requestId,
        sessionId = "session-1",
        prompt = "$requestId question",
        mode = QuestionMode.SINGLE,
        createdAt = "2026-07-29T10:00:00.000Z",
        expiresAt = null,
        urgency = urgency
    )

    private fun questionChatWorkflowState(
        key: QuestionChatBindingKey = QuestionChatBindingKey("https://postbox.example/", "ask-chat"),
        tabsVisible: Boolean = false,
        selectedTab: QuestionChatWorkspaceTab = QuestionChatWorkspaceTab.QUESTION,
        owner: QuestionChatOwnerState = QuestionChatOwnerState(key = key)
    ) = QuestionChatWorkflowUiState(
        key = key,
        owner = owner,
        tabsVisible = tabsVisible,
        selectedTab = selectedTab,
        questionFocusToken = 0L
    )
}

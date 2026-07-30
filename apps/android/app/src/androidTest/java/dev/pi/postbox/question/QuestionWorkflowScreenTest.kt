package dev.pi.postbox.question

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import dev.pi.postbox.ui.theme.PostboxTheme
import org.junit.Assert.assertEquals
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

        composeRule.onNode(hasSetTextAction()).assertTextEquals("Keep my draft")
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

        composeRule.onNode(hasSetTextAction()).assertTextEquals("Restored secure note")
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
        onRefresh: () -> Unit = {}
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
                    onRefresh = onRefresh
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
}

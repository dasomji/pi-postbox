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
    fun questionDetailShowsRichOptionFieldsAndChatProvenanceAccessibly() {
        var toggledValue: String? = null
        val question = QuestionDetailUiState(
            requestId = "ask-high",
            sessionId = "session-1",
            mode = QuestionMode.SINGLE,
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
                            expiresAt = null
                        )
                    ),
                    visibleQuestion = question,
                    navigationSelection = QuestionNavigationSelection.Question(question.requestId)
                )
            },
            onToggleOption = { toggledValue = it }
        )

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

        setQuestionScreen(stateProvider = { screenState.value })

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
    fun pullingDownFromTheQueueRequestsOneRefresh() {
        var refreshRequests = 0
        setQuestionScreen(
            stateProvider = {
                QuestionWorkflowState(
                    baseUrl = "https://postbox.example/",
                    isLoading = false,
                    isSyncing = false,
                    connectionState = QuestionConnectionState.CONNECTED,
                    pendingQuestions = listOf(question("normal")),
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
    fun queueShowsEveryPendingQuestion() {
        setQuestionScreen(
            stateProvider = {
                QuestionWorkflowState(
                    baseUrl = "https://postbox.example/",
                    isLoading = false,
                    isSyncing = false,
                    connectionState = QuestionConnectionState.CONNECTED,
                    pendingQuestions = listOf(
                        question("first"), question("second"), question("third")
                    ),
                    navigationSelection = QuestionNavigationSelection.Queue
                )
            }
        )

        listOf("first question", "second question", "third question").forEach {
            composeRule.onNodeWithText(it).assertIsDisplayed()
        }
    }

    private fun setQuestionScreen(
        stateProvider: () -> QuestionWorkflowState,
        onToggleOption: (String) -> Unit = {},
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
                    onSubmitAnswer = {},
                    onCancelQuestion = {},
                    onDismissQuestion = {},
                    onEditServerUrl = {},
                    onRefresh = onRefresh
                )
            }
        }
    }

    private fun question(requestId: String) = QuestionListItemUiState(
        requestId = requestId,
        sessionId = "session-1",
        prompt = "$requestId question",
        mode = QuestionMode.SINGLE,
        createdAt = "2026-07-29T10:00:00.000Z",
        expiresAt = null
    )
}

package dev.pi.postbox.question

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import dev.pi.postbox.questionchat.QuestionChatBindingKey
import dev.pi.postbox.questionchat.QuestionChatConnectionState
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class QuestionChatUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun composerControlsRespectProvidedImeAndNavigationInsets() {
        val insetBottom = 120.dp
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize(),
                    composerInsetModifier = Modifier.padding(bottom = insetBottom)
                )
            }
        }

        composeRule.waitForIdle()

        val rootBottom = composeRule.onRoot().fetchSemanticsNode().boundsInRoot.bottom
        val stopBottom = composeRule.onNodeWithText("Stop").fetchSemanticsNode().boundsInRoot.bottom
        val sendBottom = composeRule.onNodeWithText("Send").fetchSemanticsNode().boundsInRoot.bottom

        val expectedGap = with(composeRule.density) { insetBottom.toPx() }
        assertTrue(rootBottom - stopBottom >= expectedGap - 1f)
        assertTrue(rootBottom - sendBottom >= expectedGap - 1f)
    }

    @Test
    fun emptyReadyChatShowsTheStarterSetOnlyOnce() {
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(state = QuestionChatState.READY),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        composeRule.onAllNodesWithText("Elaborate").assertCountEquals(1)
        composeRule.onAllNodesWithText("Pro–Cons").assertCountEquals(1)
        composeRule.onAllNodesWithText("Teach me").assertCountEquals(1)
        composeRule.onNodeWithText("Send").assertIsDisplayed()
        composeRule.onAllNodesWithText("Steer").assertCountEquals(0)
    }

    @Test
    fun generatingChatMatchesTheWebActionHierarchy() {
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(
                        state = QuestionChatState.GENERATING,
                        messages = listOf(
                            QuestionChatMessage.User(id = "user-1", text = "What changed?"),
                            QuestionChatMessage.Assistant(
                                id = "assistant-1",
                                text = "Still thinking",
                                status = QuestionChatMessage.Assistant.Status.STREAMING
                            )
                        ),
                        tools = listOf(
                            QuestionChatToolActivity(
                                id = "tool-1",
                                tool = "repository_read",
                                target = "apps/android/app/src/main/java/dev/pi/postbox/question/QuestionWorkflowScreen.kt",
                                state = "running",
                                details = "Reading the current Question Chat layout."
                            )
                        )
                    ),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        composeRule.onNodeWithText("Answering…").assertIsDisplayed()
        composeRule.onNodeWithText("Send").assertIsDisplayed()
        composeRule.onNodeWithText("Stop").assertIsDisplayed()
        composeRule.onNodeWithText("Read").assertIsDisplayed()
        composeRule.onAllNodesWithText("Question Chat answering").assertCountEquals(0)
        composeRule.onAllNodesWithText("Steer").assertCountEquals(0)
        composeRule.onAllNodesWithText("Elaborate").assertCountEquals(0)
    }

    @Test
    fun proposalActionsUseWebCopyAndTranscriptOverflowShowsNoJumpAffordance() {
        val longAssistantText = List(24) { "Answer line ${it + 1}" }.joinToString("\n")
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(
                        state = QuestionChatState.READY,
                        messages = List(8) { index ->
                            QuestionChatMessage.Assistant(
                                id = "assistant-$index",
                                text = longAssistantText,
                                status = QuestionChatMessage.Assistant.Status.FINAL
                            )
                        },
                        tools = listOf(
                            QuestionChatToolActivity(
                                id = "tool-1",
                                tool = "propose_answer",
                                target = "Ship now",
                                state = "success",
                                actionOptionValue = "ship"
                            )
                        )
                    ),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        composeRule.waitForIdle()
        composeRule.onNodeWithText("View in Question").performScrollTo().assertIsDisplayed()
        composeRule.onAllNodesWithText("Review in Question").assertCountEquals(0)
        composeRule.onAllNodesWithText("Jump to latest").assertCountEquals(0)
    }

    @Test
    fun startersExposeButtonSemanticsWithMaterialTouchTargets() {
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(state = QuestionChatState.READY),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        composeRule.onNodeWithText("Elaborate")
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .assertHeightIsAtLeast(48.dp)
    }
}

@Composable
private fun TestTheme(content: @Composable () -> Unit) {
    PostboxTheme {
        content()
    }
}

private fun questionChatWorkflow(
    state: QuestionChatState = QuestionChatState.GENERATING,
    messages: List<QuestionChatMessage> = emptyList(),
    tools: List<QuestionChatToolActivity> = emptyList()
): QuestionChatWorkflowUiState {
    val key = QuestionChatBindingKey("https://postbox.example/", "ask-1")
    return QuestionChatWorkflowUiState(
        key = key,
        owner = QuestionChatOwnerState(
            key = key,
            knownStarted = true,
            session = QuestionChatSessionUiState(
                snapshot = QuestionChatSnapshot(
                    requestId = "ask-1",
                    state = state,
                    forkKind = QuestionChatForkKind.EXACT,
                    model = QuestionChatModel(
                        id = "anthropic/claude-sonnet-4",
                        source = QuestionChatModelSource.ORIGINATING
                    ),
                    sequence = messages.size + tools.size,
                    messages = messages,
                    tools = tools
                ),
                connection = QuestionChatConnectionState.ONLINE
            ),
            draftText = "Explain this"
        ),
        tabsVisible = true,
        selectedTab = QuestionChatWorkspaceTab.CHAT,
        questionFocusToken = 0L
    )
}

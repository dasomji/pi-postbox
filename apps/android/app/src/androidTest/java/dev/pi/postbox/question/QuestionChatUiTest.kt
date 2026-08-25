package dev.pi.postbox.question

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
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
import dev.pi.postbox.questionchat.QuestionChatStarter
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.QuestionChatToolActivity
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.ui.theme.PostalColors
import dev.pi.postbox.ui.theme.PostboxTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class QuestionChatUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun readyChatUsesConnectedBorderAndSendBubbleWithoutLegacyHeaderChrome() {
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

        composeRule.onAllNodesWithText("Question Chat").assertCountEquals(0)
        composeRule.onAllNodesWithText("Ready").assertCountEquals(0)
        composeRule.onAllNodesWithText("Send").assertCountEquals(0)
        composeRule.onNodeWithContentDescription("Send").assertIsDisplayed().assertHasClickAction()
        composeRule.onAllNodesWithContentDescription("Stop").assertCountEquals(0)
        assertWorkspaceBorderColor(PostalColors.success)
    }

    @Test
    fun offlineChatUsesDisconnectedBorderAndVisibleStatusCopy() {
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = questionChatWorkflow(
                        state = QuestionChatState.READY,
                        connection = QuestionChatConnectionState.OFFLINE,
                        messages = listOf(
                            QuestionChatMessage.Assistant(
                                id = "assistant-1",
                                text = "Keep this rendered.",
                                status = QuestionChatMessage.Assistant.Status.FINAL
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

        composeRule.onNodeWithText("Chat offline · showing last synchronized messages").assertIsDisplayed()
        composeRule.onNodeWithText("Keep this rendered.").assertIsDisplayed()
        assertWorkspaceBorderColor(PostalColors.danger)
    }

    @Test
    fun generatingChatSwapsTheComposerActionToStopWithoutRenderingASeparateStopButton() {
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

        composeRule.onNodeWithTag(QUESTION_CHAT_SEND_BUTTON_TEST_TAG).assertIsDisplayed().assertHasClickAction()
        composeRule.onNodeWithContentDescription("Stop").assertIsDisplayed().assertHasClickAction()
        composeRule.onNodeWithText("Read").assertIsDisplayed()
        composeRule.onAllNodesWithText("Stop").assertCountEquals(0)
        composeRule.onAllNodesWithContentDescription("Send").assertCountEquals(0)
        composeRule.onAllNodesWithContentDescription("Steer").assertCountEquals(0)
        composeRule.onAllNodesWithText("Elaborate").assertCountEquals(0)
        assertWorkspaceBorderColor(PostalColors.success)
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
    fun startersUseCompactVisualPillsWhileKeepingMaterialTouchTargets() {
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

        val touchTarget = composeRule.onNodeWithText("Elaborate")
        touchTarget
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .assertHeightIsAtLeast(48.dp)

        val touchTargetHeight = touchTarget.fetchSemanticsNode().boundsInRoot.height
        val visualHeight = composeRule
            .onNodeWithTag(
                questionChatStarterVisualTestTag(QuestionChatStarter.ELABORATE),
                useUnmergedTree = true
            )
            .fetchSemanticsNode()
            .boundsInRoot
            .height

        assertTrue(touchTargetHeight >= with(composeRule.density) { 48.dp.toPx() } - 1f)
        assertTrue(visualHeight <= with(composeRule.density) { 32.dp.toPx() } + 1f)
    }

    private fun assertWorkspaceBorderColor(expected: Color) {
        val pixels = composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_TEST_TAG).captureToImage().toPixelMap()
        val sample = pixels[pixels.width / 2, minOf(4, pixels.height - 1)]
        assertColorNear(expected, sample)
    }

    private fun assertColorNear(expected: Color, actual: Color, tolerance: Int = 8) {
        fun channel(value: Int, shift: Int): Int = value shr shift and 0xFF
        val expectedArgb = expected.toArgb()
        val actualArgb = actual.toArgb()
        assertTrue(kotlin.math.abs(channel(expectedArgb, 24) - channel(actualArgb, 24)) <= tolerance)
        assertTrue(kotlin.math.abs(channel(expectedArgb, 16) - channel(actualArgb, 16)) <= tolerance)
        assertTrue(kotlin.math.abs(channel(expectedArgb, 8) - channel(actualArgb, 8)) <= tolerance)
        assertTrue(kotlin.math.abs(channel(expectedArgb, 0) - channel(actualArgb, 0)) <= tolerance)
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
    connection: QuestionChatConnectionState = QuestionChatConnectionState.ONLINE,
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
                connection = connection
            ),
            draftText = "Explain this"
        ),
        tabsVisible = true,
        selectedTab = QuestionChatWorkspaceTab.CHAT,
        questionFocusToken = 0L
    )
}

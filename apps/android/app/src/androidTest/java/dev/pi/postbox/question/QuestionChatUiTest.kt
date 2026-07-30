package dev.pi.postbox.question

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import dev.pi.postbox.questionchat.QuestionChatBindingKey
import dev.pi.postbox.questionchat.QuestionChatConnectionState
import dev.pi.postbox.questionchat.QuestionChatForkKind
import dev.pi.postbox.questionchat.QuestionChatModel
import dev.pi.postbox.questionchat.QuestionChatModelSource
import dev.pi.postbox.questionchat.QuestionChatOwnerState
import dev.pi.postbox.questionchat.QuestionChatSessionUiState
import dev.pi.postbox.questionchat.QuestionChatSnapshot
import dev.pi.postbox.questionchat.QuestionChatState
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
                    workflow = generatingQuestionChatWorkflow(),
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
        val steerBottom = composeRule.onNodeWithText("Steer").fetchSemanticsNode().boundsInRoot.bottom

        val expectedGap = with(composeRule.density) { insetBottom.toPx() }
        assertTrue(rootBottom - stopBottom >= expectedGap - 1f)
        assertTrue(rootBottom - steerBottom >= expectedGap - 1f)
    }
}

@Composable
private fun TestTheme(content: @Composable () -> Unit) {
    PostboxTheme {
        content()
    }
}

private fun generatingQuestionChatWorkflow(): QuestionChatWorkflowUiState {
    val key = QuestionChatBindingKey("https://postbox.example/", "ask-1")
    return QuestionChatWorkflowUiState(
        key = key,
        owner = QuestionChatOwnerState(
            key = key,
            knownStarted = true,
            session = QuestionChatSessionUiState(
                snapshot = QuestionChatSnapshot(
                    requestId = "ask-1",
                    state = QuestionChatState.GENERATING,
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
            ),
            draftText = "Explain this"
        ),
        tabsVisible = true,
        selectedTab = QuestionChatWorkspaceTab.CHAT,
        questionFocusToken = 0L
    )
}

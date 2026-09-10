package dev.pi.postbox.question

import android.graphics.Point
import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
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
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.ui.theme.PostboxTheme
import java.io.InputStreamReader
import kotlin.math.abs
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class QuestionChatImeGeometryTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<QuestionTestHostActivity>()

    @Test
    fun composerUsesOneRealKeyboardOwnershipPathAndShrinksHistory() {
        enableSoftKeyboardForTheEmulator()
        val keyboardToken = mutableStateOf(0)

        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = geometryQuestionChatWorkflow(),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize(),
                    forceKeyboardVisibleToken = keyboardToken.value
                )
            }
        }

        composeRule.onNodeWithTag(QUESTION_CHAT_HISTORY_TEST_TAG).assertIsDisplayed()
        composeRule.waitForIdle()

        val threshold = with(composeRule.density) { 96.dp.toPx() }
        val tolerance = with(composeRule.density) { 18.dp.toPx() }
        val before = captureLayoutSnapshot()
        val initialRootHeight = rootViewHeight()

        composeRule.runOnUiThread { keyboardToken.value = 1 }
        composeRule.onNodeWithContentDescription("Message Question Chat").performClick()
        tapComposerField()

        var maxImeBottom = 0
        var minimumRootHeight = initialRootHeight
        var imeVisible = false
        for (attempt in 1..30) {
            composeRule.waitForIdle()
            maxImeBottom = maxOf(maxImeBottom, currentImeBottom())
            minimumRootHeight = minOf(minimumRootHeight, rootViewHeight())
            if (maxImeBottom.toFloat() > threshold || minimumRootHeight < initialRootHeight - threshold / 2f) {
                imeVisible = true
                break
            }
            SystemClock.sleep(500)
        }
        assumeTrue(
            "real IME never appeared on this emulator run: maxImeBottom=$maxImeBottom initialRootHeight=$initialRootHeight minimumRootHeight=$minimumRootHeight",
            imeVisible
        )
        SystemClock.sleep(750)
        composeRule.waitForIdle()

        val after = captureLayoutSnapshot()
        val resizeDelta = (before.workspaceBottom - after.workspaceBottom).coerceAtLeast(0f)
        val imeInsetBottom = currentImeBottom().toFloat()
        val keyboardShift = maxOf(resizeDelta, imeInsetBottom)
        val actualGapDelta = after.composerBottomGap - before.composerBottomGap

        assertTrue(
            "keyboardShift=$keyboardShift resizeDelta=$resizeDelta imeInsetBottom=$imeInsetBottom actualGapDelta=$actualGapDelta before=$before after=$after",
            keyboardShift > threshold / 2f
        )
        assertTrue(
            "keyboard shift should come from exactly one ownership path: keyboardShift=$keyboardShift actualGapDelta=$actualGapDelta",
            abs(actualGapDelta - keyboardShift) <= tolerance
        )
        assertTrue(after.historyBottom <= after.composerTop + tolerance)
        assertTrue(
            "history should shrink once the real keyboard is visible: before=${before.historyHeight} after=${after.historyHeight}",
            after.historyHeight < before.historyHeight - with(composeRule.density) { 40.dp.toPx() }
        )
    }

    private fun captureLayoutSnapshot(): LayoutSnapshot {
        val workspaceBounds = composeRule.onNodeWithTag(QUESTION_CHAT_WORKSPACE_TEST_TAG).fetchSemanticsNode().boundsInWindow
        val historyBounds = composeRule.onNodeWithTag(QUESTION_CHAT_HISTORY_TEST_TAG).fetchSemanticsNode().boundsInWindow
        val composerBounds = composeRule.onNodeWithTag(QUESTION_CHAT_COMPOSER_ROW_TEST_TAG).fetchSemanticsNode().boundsInWindow
        val displayHeight = realDisplayHeight()
        return LayoutSnapshot(
            workspaceBottom = workspaceBounds.bottom,
            historyHeight = historyBounds.height,
            historyBottom = historyBounds.bottom,
            composerTop = composerBounds.top,
            composerBottomGap = displayHeight - composerBounds.bottom
        )
    }

    private fun currentImeBottom(): Int =
        ViewCompat.getRootWindowInsets(composeRule.activity.window.decorView)
            ?.getInsets(WindowInsetsCompat.Type.ime())
            ?.bottom
            ?: 0

    private fun rootViewHeight(): Float = composeRule.activity.window.decorView.rootView.height.toFloat()

    private fun realDisplayHeight(): Float {
        val size = Point()
        @Suppress("DEPRECATION")
        composeRule.activity.windowManager.defaultDisplay.getRealSize(size)
        return size.y.toFloat()
    }

    private fun enableSoftKeyboardForTheEmulator() {
        runShellCommand("settings put secure show_ime_with_hard_keyboard 1")
        runShellCommand("ime enable com.example.android.softkeyboard/.SoftKeyboard")
        runShellCommand("ime set com.example.android.softkeyboard/.SoftKeyboard")
    }

    private fun tapComposerField() {
        val bounds = composeRule.onNodeWithContentDescription("Message Question Chat").fetchSemanticsNode().boundsInWindow
        runShellCommand("input tap ${bounds.center.x.toInt()} ${bounds.center.y.toInt()}")
    }

    private fun runShellCommand(command: String) {
        InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand(command)
            .use {
                InputStreamReader(android.os.ParcelFileDescriptor.AutoCloseInputStream(it)).use { stream -> stream.readText() }
            }
    }
}

private data class LayoutSnapshot(
    val workspaceBottom: Float,
    val historyHeight: Float,
    val historyBottom: Float,
    val composerTop: Float,
    val composerBottomGap: Float
)

@Composable
private fun TestTheme(content: @Composable () -> Unit) {
    PostboxTheme {
        content()
    }
}

private fun geometryQuestionChatWorkflow(): QuestionChatWorkflowUiState {
    val key = QuestionChatBindingKey("https://postbox.example/", "ask-ime")
    return QuestionChatWorkflowUiState(
        key = key,
        owner = QuestionChatOwnerState(
            key = key,
            knownStarted = true,
            draftText = "Explain this",
            session = QuestionChatSessionUiState(
                snapshot = QuestionChatSnapshot(
                    requestId = "ask-ime",
                    state = QuestionChatState.READY,
                    forkKind = QuestionChatForkKind.FRESH,
                    model = QuestionChatModel(
                        id = "anthropic/claude-sonnet-4",
                        source = QuestionChatModelSource.POSTBOX_SETTINGS
                    ),
                    sequence = 12,
                    messages = List(12) { index ->
                        if (index % 2 == 0) {
                            QuestionChatMessage.User(
                                id = "user-$index",
                                text = "Question message ${index + 1}"
                            )
                        } else {
                            QuestionChatMessage.Assistant(
                                id = "assistant-$index",
                                text = "Assistant answer ${index + 1}",
                                status = QuestionChatMessage.Assistant.Status.FINAL
                            )
                        }
                    },
                    tools = emptyList()
                ),
                connection = QuestionChatConnectionState.ONLINE
            )
        ),
        tabsVisible = true,
        selectedTab = QuestionChatWorkspaceTab.CHAT,
        questionFocusToken = 0L
    )
}

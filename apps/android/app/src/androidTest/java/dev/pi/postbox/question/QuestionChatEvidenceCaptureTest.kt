package dev.pi.postbox.question

import android.os.SystemClock
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
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
import dev.pi.postbox.questionchat.QuestionChatToolActivity
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.ui.theme.PostboxTheme
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

class QuestionChatEvidenceCaptureTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<QuestionTestHostActivity>()

    private val prefix: String? = InstrumentationRegistry.getArguments().getString("prefix")

    @Test
    fun idleComposer() {
        assumeTrue(!prefix.isNullOrBlank())
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = evidenceChatWorkflow(state = QuestionChatState.READY, messages = seededMessages()),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onConfirmContextOnlyQuestionChat = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        saveScreenshot("idle-composer")
    }

    @Test
    fun generatingComposerStop() {
        assumeTrue(!prefix.isNullOrBlank())
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = evidenceChatWorkflow(
                        state = QuestionChatState.GENERATING,
                        messages = seededMessages() + QuestionChatMessage.Assistant(
                            id = "assistant-live",
                            text = "Still thinking",
                            status = QuestionChatMessage.Assistant.Status.STREAMING
                        ),
                        tools = listOf(
                            QuestionChatToolActivity(
                                id = "tool-1",
                                tool = "repository_read",
                                target = "apps/android/app/src/main/java/dev/pi/postbox/question/QuestionChatUi.kt",
                                state = "running",
                                details = "Reading the current Question Chat layout."
                            )
                        )
                    ),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onConfirmContextOnlyQuestionChat = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        saveScreenshot("generating-stop-composer")
    }

    @Test
    fun keyboardVisible() {
        assumeTrue(!prefix.isNullOrBlank())
        enableSoftKeyboardForTheEmulator()
        val keyboardToken = mutableStateOf(0)
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = evidenceChatWorkflow(state = QuestionChatState.READY, messages = seededMessages()),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onConfirmContextOnlyQuestionChat = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize(),
                    forceKeyboardVisibleToken = keyboardToken.value
                )
            }
        }

        composeRule.waitForIdle()
        val threshold = with(composeRule.density) { 96.dp.toPx() }
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

        saveScreenshot("keyboard-visible")
    }

    @Test
    fun starterPills() {
        assumeTrue(!prefix.isNullOrBlank())
        composeRule.setContent {
            TestTheme {
                QuestionChatPanel(
                    workflow = evidenceChatWorkflow(state = QuestionChatState.READY, messages = emptyList()),
                    onRetry = {},
                    onDraftChanged = {},
                    onSendDraft = {},
                    onSendStarter = {},
                    onConfirmContextOnlyQuestionChat = {},
                    onStop = {},
                    onReviewSuggestion = {},
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        saveScreenshot("starter-pills")
    }

    @Test
    fun questionActionRow() {
        assumeTrue(!prefix.isNullOrBlank())
        composeRule.setContent {
            TestTheme {
                QuestionWorkflowScreen(
                    state = questionActionRowState(),
                    onShowQueue = {},
                    onSelectProject = {},
                    onSelectSession = {},
                    onSelectQuestion = {},
                    onToggleOption = {},
                    onNoteChanged = {},
                    onRetryDraftSave = {},
                    onSubmitAnswer = {},
                    onCancelQuestion = {},
                    onDismissQuestion = {},
                    onEditServerUrl = {},
                    onRefresh = {},
                    onStartQuestionChat = {},
                    onConfirmContextOnlyQuestionChat = {},
                    onRetryQuestionChat = {},
                    onSelectQuestionChatTab = {},
                    onQuestionChatDraftChanged = {},
                    onSendQuestionChatDraft = {},
                    onSendQuestionChatStarter = {},
                    onStopQuestionChat = {},
                    onReviewQuestionChatSuggestion = {},
                    onHandleBack = { false },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        saveScreenshot("question-action-row")
    }

    private fun saveScreenshot(name: String) {
        composeRule.waitForIdle()
        SystemClock.sleep(750)
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "android-chat-ui-evidence-v3")
        directory.mkdirs()
        val file = File(directory, "${prefix}-${name}.png")
        FileOutputStream(file).use { stream: FileOutputStream ->
            composeRule.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
        }
    }

    private fun currentImeBottom(): Int =
        ViewCompat.getRootWindowInsets(composeRule.activity.window.decorView)
            ?.getInsets(WindowInsetsCompat.Type.ime())
            ?.bottom
            ?: 0

    private fun rootViewHeight(): Float = composeRule.activity.window.decorView.rootView.height.toFloat()

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

@Composable
private fun TestTheme(content: @Composable () -> Unit) {
    PostboxTheme {
        content()
    }
}

private fun evidenceChatWorkflow(
    state: QuestionChatState,
    messages: List<QuestionChatMessage>,
    tools: List<QuestionChatToolActivity> = emptyList()
): QuestionChatWorkflowUiState {
    val key = QuestionChatBindingKey("https://postbox.example/", "ask-evidence")
    return QuestionChatWorkflowUiState(
        key = key,
        owner = QuestionChatOwnerState(
            key = key,
            knownStarted = true,
            draftText = "Explain this",
            session = QuestionChatSessionUiState(
                snapshot = QuestionChatSnapshot(
                    requestId = "ask-evidence",
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
            )
        ),
        tabsVisible = true,
        selectedTab = QuestionChatWorkspaceTab.CHAT,
        questionFocusToken = 0L
    )
}

private fun seededMessages(): List<QuestionChatMessage> = listOf(
    QuestionChatMessage.User(id = "user-1", text = "What changed?"),
    QuestionChatMessage.Assistant(
        id = "assistant-1",
        text = "We tightened the Android chat layout and action hierarchy.",
        status = QuestionChatMessage.Assistant.Status.FINAL
    )
)

private fun questionActionRowState(): QuestionWorkflowState {
    val question = QuestionDetailUiState(
        requestId = "ask-actions-row",
        sessionId = "session-1",
        mode = QuestionMode.SINGLE,
        prompt = "Choose a deployment target",
        questionContext = null,
        relevance = null,
        decisionImpact = null,
        options = listOf(QuestionOptionUiState("ship", "Ship", null)),
        handoffContext = null,
        forkReference = null,
        selectedValues = listOf("ship"),
        canSubmit = true,
        availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
    )
    return QuestionWorkflowState(
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
}

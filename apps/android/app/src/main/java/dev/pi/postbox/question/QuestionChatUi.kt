package dev.pi.postbox.question

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pi.postbox.questionchat.QuestionChatActivationUiState
import dev.pi.postbox.questionchat.QuestionChatConnectionState
import dev.pi.postbox.questionchat.QuestionChatForkKind
import dev.pi.postbox.questionchat.QuestionChatMessage
import dev.pi.postbox.questionchat.QuestionChatRenderedAssistantMessage
import dev.pi.postbox.questionchat.QuestionChatStarter
import dev.pi.postbox.questionchat.QuestionChatSnapshot
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.QuestionChatToolActivity
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.questionchat.SafeMarkdownBlock
import dev.pi.postbox.questionchat.SafeMarkdownDocument
import dev.pi.postbox.questionchat.SafeMarkdownInline
import dev.pi.postbox.questionchat.SafeMarkdownRenderResult
import dev.pi.postbox.ui.theme.PostalColors
import dev.pi.postbox.ui.theme.PostalDisplayFontFamily
import java.net.URI
import kotlinx.coroutines.launch

private const val QUESTION_CHAT_LINK_TAG = "question-chat-link"
private const val QUESTION_CHAT_CODE_COLLAPSED_LINES = 8

@Composable
internal fun QuestionChatTabRow(
    selectedTab: QuestionChatWorkspaceTab,
    onSelectTab: (QuestionChatWorkspaceTab) -> Unit
) {
    TabRow(selectedTabIndex = if (selectedTab == QuestionChatWorkspaceTab.QUESTION) 0 else 1) {
        Tab(
            selected = selectedTab == QuestionChatWorkspaceTab.QUESTION,
            onClick = { onSelectTab(QuestionChatWorkspaceTab.QUESTION) },
            text = { Text("Question") }
        )
        Tab(
            selected = selectedTab == QuestionChatWorkspaceTab.CHAT,
            onClick = { onSelectTab(QuestionChatWorkspaceTab.CHAT) },
            text = { Text("Question Chat") }
        )
    }
}

@Composable
internal fun QuestionChatQuestionEntry(
    workflow: QuestionChatWorkflowUiState,
    onStartQuestionChat: () -> Unit,
    onConfirmContextOnlyQuestionChat: () -> Unit,
    onRetryQuestionChat: () -> Unit
) {
    if (workflow.tabsVisible) return
    val owner = workflow.owner
    val activation = owner.activation
    var showContextConfirmation by remember(workflow.key) { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
            .background(PostalColors.elevated, RoundedCornerShape(12.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(
            text = "Question Chat",
            fontFamily = PostalDisplayFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = PostalColors.text
        )
        Text(
            text = "Question Chat is temporary and first tries an exact fork of the asking Pi session.",
            fontSize = 14.sp,
            color = PostalColors.subtle,
            lineHeight = 20.sp
        )
        when (activation) {
            QuestionChatActivationUiState.Idle -> {
                Button(onClick = onStartQuestionChat) {
                    Text("Start Question Chat")
                }
            }
            QuestionChatActivationUiState.Probing -> {
                Text("Checking for an existing Question Chat…", color = PostalColors.muted, fontSize = 13.sp)
            }
            QuestionChatActivationUiState.ActivatingExact,
            QuestionChatActivationUiState.ActivatingContextFallback -> {
                Text("Starting Question Chat…", color = PostalColors.muted, fontSize = 13.sp)
            }
            is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation -> {
                Text(activation.error.message, color = PostalColors.warningForeground, fontSize = 13.sp)
                Button(onClick = { showContextConfirmation = true }) {
                    Text("Consider context-only interviewer")
                }
                TextButton(onClick = onRetryQuestionChat) {
                    Text("Retry")
                }
            }
            is QuestionChatActivationUiState.Unavailable -> {
                Text(activation.error.message, color = PostalColors.dangerForeground, fontSize = 13.sp)
                TextButton(onClick = onRetryQuestionChat) {
                    Text("Retry")
                }
            }
        }
        owner.actionMessage?.let { message ->
            Text(message, color = PostalColors.dangerForeground, fontSize = 13.sp)
        }
    }

    if (showContextConfirmation && activation is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation) {
        AlertDialog(
            onDismissRequest = { showContextConfirmation = false },
            title = { Text("Start context-only interviewer") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("A context-only interviewer starts fresh from the persisted question and handoff context.")
                    Text("It is not an exact fork of the originating Pi session.")
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showContextConfirmation = false
                        onConfirmContextOnlyQuestionChat()
                    }
                ) {
                    Text("Start context-only interviewer")
                }
            },
            dismissButton = {
                TextButton(onClick = { showContextConfirmation = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
internal fun QuestionChatPanel(
    workflow: QuestionChatWorkflowUiState,
    onRetry: () -> Unit,
    onDraftChanged: (String) -> Unit,
    onSendDraft: () -> Unit,
    onSendStarter: (QuestionChatStarter) -> Unit,
    onStop: () -> Unit,
    onReviewSuggestion: (String) -> Unit,
    modifier: Modifier = Modifier,
    composerInsetModifier: Modifier = Modifier.imePadding().navigationBarsPadding()
) {
    val owner = workflow.owner
    val session = owner.session
    val scrollState = rememberScrollState()
    val coroutineScope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    var pendingLink by remember(workflow.key) { mutableStateOf<String?>(null) }

    LaunchedEffect(owner.composerFocusToken) {
        if (owner.composerFocusToken > 0L) {
            focusRequester.requestFocus()
        }
    }
    LaunchedEffect(workflow.key, session?.snapshot?.sequence, session?.snapshot?.tools?.size) {
        if (scrollState.maxValue - scrollState.value < 160) {
            scrollState.scrollTo(scrollState.maxValue)
        }
    }

    val canInteract = session?.connection == QuestionChatConnectionState.ONLINE
    val sendLabel = if (session?.snapshot?.state == QuestionChatState.GENERATING) "Steer" else "Send"
    val jumpToLatestVisible = scrollState.maxValue - scrollState.value >= 160

    Column(
        modifier = modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        session?.let { current ->
            QuestionChatDisclosureCard(snapshot = current.snapshot)
            QuestionChatStatusBanner(connection = current.connection, state = current.snapshot.state, onRetry = onRetry)
        }
        owner.actionMessage?.let { message ->
            Text(message, color = PostalColors.dangerForeground, fontSize = 13.sp)
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
                .background(PostalColors.elevated, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (session == null || session.snapshot.messages.isEmpty()) {
                    Text(
                        text = "Question Chat can help you understand this decision, but it cannot answer the Postbox Question for you.",
                        fontSize = 14.sp,
                        color = PostalColors.subtle,
                        lineHeight = 20.sp
                    )
                    StarterButtons(enabled = canInteract, onSendStarter = onSendStarter)
                }
                session?.snapshot?.messages?.forEach { message ->
                    QuestionChatMessageCard(
                        message = message,
                        renderedAssistantMessage = owner.renderedAssistantMessages[message.id],
                        onLinkClick = { pendingLink = it },
                        onCopyCode = { clipboard.setText(AnnotatedString(it)) }
                    )
                }
                session?.snapshot?.tools?.takeIf { it.isNotEmpty() }?.let { tools ->
                    QuestionChatToolSection(tools = tools, onReviewSuggestion = onReviewSuggestion)
                }
            }
            if (jumpToLatestVisible) {
                TextButton(
                    onClick = { coroutineScope.launch { scrollState.animateScrollTo(scrollState.maxValue) } },
                    modifier = Modifier.align(Alignment.BottomEnd)
                ) {
                    Text("Jump to latest")
                }
            }
        }
        StarterButtons(enabled = canInteract, onSendStarter = onSendStarter)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(composerInsetModifier),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            OutlinedTextField(
                value = owner.draftText,
                onValueChange = onDraftChanged,
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester),
                minLines = 2,
                maxLines = 4,
                enabled = canInteract,
                label = { Text("Ask Question Chat") }
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (session?.snapshot?.state == QuestionChatState.GENERATING || session?.snapshot?.state == QuestionChatState.STOPPING) {
                    Button(onClick = onStop, enabled = canInteract && owner.pendingStopCommandId == null) {
                        Text("Stop")
                    }
                }
                Button(
                    onClick = onSendDraft,
                    enabled = canInteract && owner.pendingSend == null && owner.draftText.isNotBlank()
                ) {
                    Text(sendLabel)
                }
            }
        }
    }

    pendingLink?.let { url ->
        val host = safeQuestionChatHost(url)
        AlertDialog(
            onDismissRequest = { pendingLink = null },
            title = { Text("Open link") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(host ?: "External link")
                    SelectionContainer { Text(url) }
                }
            },
            confirmButton = {
                Button(onClick = {
                    if (isSafeQuestionChatUrl(url)) {
                        uriHandler.openUri(url)
                    }
                    pendingLink = null
                }) {
                    Text("Open externally")
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(url))
                        pendingLink = null
                    }) {
                        Text("Copy URL")
                    }
                    TextButton(onClick = { pendingLink = null }) {
                        Text("Cancel")
                    }
                }
            }
        )
    }
}

@Composable
private fun QuestionChatDisclosureCard(snapshot: QuestionChatSnapshot) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
            .background(PostalColors.elevated, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text(
            text = if (snapshot.forkKind == QuestionChatForkKind.EXACT) "Exact fork" else "Context-only interviewer",
            fontWeight = FontWeight.SemiBold,
            color = if (snapshot.forkKind == QuestionChatForkKind.EXACT) PostalColors.text else PostalColors.warningForeground
        )
        if (snapshot.forkKind == QuestionChatForkKind.CONTEXT_ONLY) {
            Text(
                text = "This interviewer starts from persisted handoff context and is not an exact fork of the Pi session.",
                fontSize = 13.sp,
                color = PostalColors.warningForeground
            )
        }
        Text("Model: ${snapshot.model.id}", fontSize = 13.sp, color = PostalColors.subtle)
        snapshot.model.fallbackReason?.let {
            Text("Using Pi's default model: $it", fontSize = 13.sp, color = PostalColors.warningForeground)
        }
    }
}

@Composable
private fun QuestionChatStatusBanner(
    connection: QuestionChatConnectionState,
    state: QuestionChatState,
    onRetry: () -> Unit
) {
    val label = when (connection) {
        QuestionChatConnectionState.SYNCHRONIZING -> "Question Chat synchronizing"
        QuestionChatConnectionState.OFFLINE -> "Question Chat offline"
        QuestionChatConnectionState.TERMINAL -> "Question Chat ended"
        QuestionChatConnectionState.ONLINE -> when (state) {
            QuestionChatState.READY -> "Question Chat ready"
            QuestionChatState.GENERATING -> "Question Chat answering"
            QuestionChatState.STOPPING -> "Question Chat stopping"
            QuestionChatState.STOPPED -> "Question Chat stopped"
            QuestionChatState.INTERRUPTED -> "Question Chat interrupted"
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
            .background(PostalColors.surface, RoundedCornerShape(12.dp))
            .padding(12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = PostalColors.subtle)
        if (connection != QuestionChatConnectionState.ONLINE) {
            TextButton(onClick = onRetry) {
                Text("Retry")
            }
        }
    }
}

@Composable
private fun StarterButtons(
    enabled: Boolean,
    onSendStarter: (QuestionChatStarter) -> Unit
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            QuestionChatStarter.ELABORATE to "Elaborate",
            QuestionChatStarter.PRO_CONS to "Pro–Cons",
            QuestionChatStarter.TEACH_ME to "Teach me"
        ).forEach { (starter, label) ->
            Text(
                text = label,
                modifier = Modifier
                    .border(1.dp, PostalColors.border, RoundedCornerShape(999.dp))
                    .background(if (enabled) PostalColors.elevated else PostalColors.surface, RoundedCornerShape(999.dp))
                    .clickable(enabled = enabled) { onSendStarter(starter) }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = if (enabled) PostalColors.text else PostalColors.muted,
                fontSize = 13.sp
            )
        }
    }
}

@Composable
private fun QuestionChatMessageCard(
    message: QuestionChatMessage,
    renderedAssistantMessage: QuestionChatRenderedAssistantMessage?,
    onLinkClick: (String) -> Unit,
    onCopyCode: (String) -> Unit
) {
    val bubbleColor = if (message is QuestionChatMessage.User) PostalColors.surface else PostalColors.elevated
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
            .background(bubbleColor, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = if (message is QuestionChatMessage.User) "You" else "Question Chat",
            fontWeight = FontWeight.SemiBold,
            color = PostalColors.subtle,
            fontSize = 13.sp
        )
        when (message) {
            is QuestionChatMessage.User -> SelectionContainer { Text(message.text) }
            is QuestionChatMessage.Assistant -> {
                val rich = renderedAssistantMessage?.rendered
                if (message.status == QuestionChatMessage.Assistant.Status.STREAMING || rich == null) {
                    SelectionContainer { Text(message.text) }
                } else {
                    when (rich) {
                        is SafeMarkdownRenderResult.PlainTextFallback -> {
                            if (rich.formattingUnavailable) {
                                Text("Formatting unavailable", color = PostalColors.muted, fontSize = 12.sp)
                            }
                            SelectionContainer { Text(rich.text) }
                        }
                        is SafeMarkdownRenderResult.Rich -> SafeMarkdownDocumentView(
                            document = rich.document,
                            onLinkClick = onLinkClick,
                            onCopyCode = onCopyCode
                        )
                    }
                }
                if (message.status != QuestionChatMessage.Assistant.Status.FINAL) {
                    Text(
                        text = when (message.status) {
                            QuestionChatMessage.Assistant.Status.STREAMING -> "Answering"
                            QuestionChatMessage.Assistant.Status.STOPPED -> "Stopped"
                            QuestionChatMessage.Assistant.Status.INTERRUPTED -> "Interrupted"
                            QuestionChatMessage.Assistant.Status.FINAL -> ""
                        },
                        color = PostalColors.muted,
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun QuestionChatToolSection(
    tools: List<QuestionChatToolActivity>,
    onReviewSuggestion: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(12.dp))
            .background(PostalColors.surface, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("Tool activity", fontWeight = FontWeight.SemiBold, color = PostalColors.subtle)
        tools.forEach { tool ->
            var expanded by remember(tool.id) { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(
                                when (tool.state) {
                                    "running" -> PostalColors.warning
                                    "success" -> PostalColors.success
                                    "error" -> PostalColors.danger
                                    else -> PostalColors.borderStrong
                                },
                                CircleShape
                            )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "${tool.tool} · ${tool.target}",
                        modifier = Modifier.weight(1f),
                        fontSize = 13.sp,
                        color = PostalColors.text,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (tool.details != null) {
                        TextButton(onClick = { expanded = !expanded }) {
                            Text(if (expanded) "Hide details" else "Details")
                        }
                    }
                }
                if (expanded && tool.details != null) {
                    SelectionContainer {
                        Text(
                            text = tool.details,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = PostalColors.subtle,
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(8.dp))
                                .padding(8.dp)
                        )
                    }
                }
                tool.actionOptionValue?.takeIf { tool.state == "success" }?.let { optionValue ->
                    Button(onClick = { onReviewSuggestion(optionValue) }) {
                        Text("Review in Question")
                    }
                }
                HorizontalDivider(color = PostalColors.border)
            }
        }
    }
}

@Composable
private fun SafeMarkdownDocumentView(
    document: SafeMarkdownDocument,
    onLinkClick: (String) -> Unit,
    onCopyCode: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        document.blocks.forEachIndexed { index, block ->
            SafeMarkdownBlockView(block = block, index = index, onLinkClick = onLinkClick, onCopyCode = onCopyCode)
        }
    }
}

@Composable
private fun SafeMarkdownBlockView(
    block: SafeMarkdownBlock,
    index: Int,
    onLinkClick: (String) -> Unit,
    onCopyCode: (String) -> Unit
) {
    when (block) {
        is SafeMarkdownBlock.Paragraph -> MarkdownInlineText(block.inlines, onLinkClick)
        is SafeMarkdownBlock.Heading -> MarkdownInlineText(
            inlines = block.inlines,
            onLinkClick = onLinkClick,
            fontWeight = FontWeight.Bold,
            fontSize = when (block.level) {
                1 -> 22.sp
                2 -> 20.sp
                3 -> 18.sp
                else -> 16.sp
            },
            modifier = Modifier.semantics { heading() }.focusable()
        )
        is SafeMarkdownBlock.Quote -> Column(
            modifier = Modifier
                .border(2.dp, PostalColors.borderStrong, RoundedCornerShape(8.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            block.blocks.forEachIndexed { childIndex, child ->
                SafeMarkdownBlockView(child, index + childIndex + 1, onLinkClick, onCopyCode)
            }
        }
        is SafeMarkdownBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            block.items.forEachIndexed { itemIndex, itemBlocks ->
                Row(verticalAlignment = Alignment.Top) {
                    Text(if (block.ordered) "${(block.startNumber ?: 1) + itemIndex}." else "•")
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        itemBlocks.forEachIndexed { childIndex, child ->
                            SafeMarkdownBlockView(child, index + itemIndex + childIndex + 1, onLinkClick, onCopyCode)
                        }
                    }
                }
            }
        }
        is SafeMarkdownBlock.CodeBlock -> QuestionChatCodeBlock(block = block, blockKey = "code-$index", onCopyCode = onCopyCode)
        SafeMarkdownBlock.ThematicBreak -> HorizontalDivider(color = PostalColors.border)
    }
}

@Composable
private fun MarkdownInlineText(
    inlines: List<SafeMarkdownInline>,
    onLinkClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight? = null,
    fontSize: androidx.compose.ui.unit.TextUnit = 15.sp
) {
    val annotated = remember(inlines) { buildMarkdownAnnotatedString(inlines) }
    ClickableText(
        text = annotated,
        modifier = modifier,
        style = androidx.compose.ui.text.TextStyle(
            color = PostalColors.text,
            fontWeight = fontWeight,
            fontSize = fontSize,
            lineHeight = 22.sp
        )
    ) { offset ->
        annotated.getStringAnnotations(QUESTION_CHAT_LINK_TAG, offset, offset)
            .firstOrNull()
            ?.let { onLinkClick(it.item) }
    }
}

private fun buildMarkdownAnnotatedString(inlines: List<SafeMarkdownInline>): AnnotatedString = buildAnnotatedString {
    fun appendChildren(children: List<SafeMarkdownInline>) {
        children.forEach { inline ->
            when (inline) {
                is SafeMarkdownInline.Text -> append(inline.text)
                is SafeMarkdownInline.Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(inline.text) }
                is SafeMarkdownInline.Emphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { appendChildren(inline.children) }
                is SafeMarkdownInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendChildren(inline.children) }
                is SafeMarkdownInline.Link -> {
                    pushStringAnnotation(QUESTION_CHAT_LINK_TAG, inline.url)
                    withStyle(SpanStyle(color = PostalColors.historyForeground)) { appendChildren(inline.children) }
                    pop()
                }
            }
        }
    }
    appendChildren(inlines)
}

@Composable
private fun QuestionChatCodeBlock(
    block: SafeMarkdownBlock.CodeBlock,
    blockKey: String,
    onCopyCode: (String) -> Unit
) {
    var expanded by remember(blockKey) { mutableStateOf(false) }
    val lineCount = remember(block.text) { block.text.lines().size }
    val collapsedHeight = (QUESTION_CHAT_CODE_COLLAPSED_LINES * 22).dp
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        block.language?.let { language ->
            Text(language, fontSize = 12.sp, color = PostalColors.muted)
        }
        val verticalScroll = rememberScrollState()
        val horizontalScroll = rememberScrollState()
        SelectionContainer {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = if (expanded) 240.dp else collapsedHeight)
                    .background(PostalColors.surface, RoundedCornerShape(8.dp))
                    .horizontalScroll(horizontalScroll)
                    .verticalScroll(verticalScroll)
                    .padding(12.dp)
            ) {
                Text(
                    text = block.text,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = PostalColors.text
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (lineCount > QUESTION_CHAT_CODE_COLLAPSED_LINES) {
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "Collapse code" else "Expand code")
                }
            }
            TextButton(onClick = { onCopyCode(block.text) }) {
                Text("Copy code")
            }
        }
        if (block.truncated) {
            Text("Truncated at the safe rendering limit.", fontSize = 12.sp, color = PostalColors.muted)
        }
    }
}

private fun isSafeQuestionChatUrl(url: String): Boolean = try {
    val uri = URI(url)
    val scheme = uri.scheme?.lowercase()
    (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
} catch (_: Exception) {
    false
}

private fun safeQuestionChatHost(url: String): String? = try {
    URI(url).host
} catch (_: Exception) {
    null
}

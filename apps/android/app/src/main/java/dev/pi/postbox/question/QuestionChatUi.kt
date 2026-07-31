package dev.pi.postbox.question

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.pi.postbox.questionchat.QuestionChatActivationUiState
import dev.pi.postbox.questionchat.QuestionChatAvailabilityError
import dev.pi.postbox.questionchat.QuestionChatConnectionState
import dev.pi.postbox.questionchat.QuestionChatContextFallbackAvailability
import dev.pi.postbox.questionchat.QuestionChatForkKind
import dev.pi.postbox.questionchat.QuestionChatMessage
import dev.pi.postbox.questionchat.QuestionChatModelSource
import dev.pi.postbox.questionchat.QuestionChatRenderedAssistantMessage
import dev.pi.postbox.questionchat.QuestionChatSnapshot
import dev.pi.postbox.questionchat.QuestionChatStarter
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.QuestionChatToolActivity
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.questionchat.SafeMarkdownBlock
import dev.pi.postbox.questionchat.SafeMarkdownDocument
import dev.pi.postbox.questionchat.SafeMarkdownInline
import dev.pi.postbox.questionchat.SafeMarkdownRenderResult
import dev.pi.postbox.ui.theme.PaperPlaneIcon
import dev.pi.postbox.ui.theme.PostalColors
import java.net.URI

private const val QUESTION_CHAT_CODE_COLLAPSED_LINES = 8
internal const val QUESTION_CHAT_WORKSPACE_TEST_TAG = "questionChatWorkspace"
internal const val QUESTION_CHAT_SEND_BUTTON_TEST_TAG = "questionChatSendButton"
internal const val QUESTION_CHAT_WORKSPACE_QUESTION_TAB_TEST_TAG = "questionChatWorkspaceQuestionTab"
internal const val QUESTION_CHAT_WORKSPACE_CHAT_TAB_TEST_TAG = "questionChatWorkspaceChatTab"

@Composable
internal fun QuestionChatTabRow(
    selectedTab: QuestionChatWorkspaceTab,
    onSelectTab: (QuestionChatWorkspaceTab) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(PostalColors.surface)
            .border(1.dp, PostalColors.border)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        QuestionChatWorkspaceTabButton(
            text = "Question",
            selected = selectedTab == QuestionChatWorkspaceTab.QUESTION,
            onClick = { onSelectTab(QuestionChatWorkspaceTab.QUESTION) },
            modifier = Modifier
                .weight(1f)
                .testTag(QUESTION_CHAT_WORKSPACE_QUESTION_TAB_TEST_TAG)
        )
        QuestionChatWorkspaceTabButton(
            text = "Chat",
            selected = selectedTab == QuestionChatWorkspaceTab.CHAT,
            onClick = { onSelectTab(QuestionChatWorkspaceTab.CHAT) },
            modifier = Modifier
                .weight(1f)
                .testTag(QUESTION_CHAT_WORKSPACE_CHAT_TAB_TEST_TAG)
        )
    }
}

@Composable
private fun QuestionChatWorkspaceTabButton(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier = modifier
            .background(if (selected) PostalColors.attention.copy(alpha = 0.1f) else Color.Transparent, shape)
            .selectable(
                selected = selected,
                role = Role.Tab,
                onClick = onClick
            )
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) PostalColors.attentionForeground else PostalColors.muted
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
    onConfirmContextOnlyQuestionChat: () -> Unit,
    onStop: () -> Unit,
    onReviewSuggestion: (String) -> Unit,
    modifier: Modifier = Modifier,
    composerInsetModifier: Modifier = Modifier
) {
    val owner = workflow.owner
    val session = owner.session
    val snapshot = session?.snapshot
    val scrollState = rememberScrollState()
    val focusRequester = remember { FocusRequester() }
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    var pendingLink by remember(workflow.key) { mutableStateOf<String?>(null) }
    var showContextOnlyConfirmation by remember(workflow.key) { mutableStateOf(false) }

    LaunchedEffect(owner.activation) {
        if (owner.activation !is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation) {
            showContextOnlyConfirmation = false
        }
    }
    LaunchedEffect(owner.composerFocusToken) {
        if (owner.composerFocusToken > 0L) {
            focusRequester.requestFocus()
        }
    }
    LaunchedEffect(workflow.key, snapshot?.sequence, snapshot?.tools?.size) {
        if (scrollState.maxValue - scrollState.value < 160) {
            scrollState.scrollTo(scrollState.maxValue)
        }
    }

    val canInteract = session?.connection == QuestionChatConnectionState.ONLINE
    val canSend =
        canInteract && owner.pendingSend == null && owner.draftText.isNotBlank() && snapshot?.state != QuestionChatState.STOPPING
    val showStop =
        snapshot?.state == QuestionChatState.GENERATING || snapshot?.state == QuestionChatState.STOPPING || owner.pendingStopCommandId != null
    val showStarters = snapshot?.messages?.isEmpty() != false

    Column(modifier = modifier.fillMaxSize()) {
        QuestionChatWorkspaceSurface(
            borderColor = questionChatWorkspaceBorderColor(owner.activation, session?.connection),
            statusDescription = questionChatWorkspaceStatusDescription(owner.activation, session?.connection),
            modifier = Modifier.fillMaxSize()
        ) {
            when {
                session != null -> {
                    QuestionChatSessionWorkspace(
                        owner = owner,
                        snapshot = snapshot ?: return@QuestionChatWorkspaceSurface,
                        connection = session.connection,
                        canInteract = canInteract,
                        canSend = canSend,
                        showStop = showStop,
                        showStarters = showStarters,
                        scrollState = scrollState,
                        focusRequester = focusRequester,
                        composerInsetModifier = composerInsetModifier,
                        onRetry = onRetry,
                        onDraftChanged = onDraftChanged,
                        onSendDraft = onSendDraft,
                        onSendStarter = onSendStarter,
                        onStop = onStop,
                        onReviewSuggestion = onReviewSuggestion,
                        onLinkClick = { pendingLink = it },
                        onCopyCode = { clipboard.setText(AnnotatedString(it)) }
                    )
                }
                owner.activation is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation -> {
                    val activation = owner.activation as QuestionChatActivationUiState.AwaitingContextFallbackConfirmation
                    QuestionChatAvailabilityWorkspace(
                        error = activation.error,
                        contextOnlyConfirmationVisible = showContextOnlyConfirmation,
                        onShowContextOnlyConfirmation = { showContextOnlyConfirmation = true },
                        onDismissContextOnlyConfirmation = { showContextOnlyConfirmation = false },
                        onConfirmContextOnlyQuestionChat = onConfirmContextOnlyQuestionChat
                    )
                }
                owner.activation is QuestionChatActivationUiState.Unavailable -> {
                    QuestionChatUnavailableWorkspace(
                        error = (owner.activation as QuestionChatActivationUiState.Unavailable).error,
                        onRetry = onRetry
                    )
                }
                owner.activation == QuestionChatActivationUiState.Probing -> {
                    QuestionChatActivationWorkspace(message = "Checking for an existing Chat…")
                }
                owner.activation == QuestionChatActivationUiState.ActivatingExact ||
                    owner.activation == QuestionChatActivationUiState.ActivatingContextFallback ||
                    owner.activation == QuestionChatActivationUiState.Idle -> {
                    QuestionChatActivationWorkspace(message = "Starting Chat…")
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
private fun QuestionChatWorkspaceSurface(
    borderColor: Color,
    statusDescription: String,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier = modifier
            .testTag(QUESTION_CHAT_WORKSPACE_TEST_TAG)
            .border(2.dp, borderColor, shape)
            .padding(16.dp)
            .semantics {
                contentDescription = statusDescription
                liveRegion = LiveRegionMode.Polite
            },
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content
    )
}

@Composable
private fun QuestionChatSessionWorkspace(
    owner: dev.pi.postbox.questionchat.QuestionChatOwnerState,
    snapshot: QuestionChatSnapshot,
    connection: QuestionChatConnectionState,
    canInteract: Boolean,
    canSend: Boolean,
    showStop: Boolean,
    showStarters: Boolean,
    scrollState: androidx.compose.foundation.ScrollState,
    focusRequester: FocusRequester,
    composerInsetModifier: Modifier,
    onRetry: () -> Unit,
    onDraftChanged: (String) -> Unit,
    onSendDraft: () -> Unit,
    onSendStarter: (QuestionChatStarter) -> Unit,
    onStop: () -> Unit,
    onReviewSuggestion: (String) -> Unit,
    onLinkClick: (String) -> Unit,
    onCopyCode: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (snapshot.forkKind == QuestionChatForkKind.CONTEXT_ONLY) {
            Text(
                text = "Context-only · degraded",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = PostalColors.warningForeground,
                modifier = Modifier
                    .background(PostalColors.warning.copy(alpha = 0.1f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
            Text(
                text = "This context-only interviewer uses persisted handoff context, not an exact fork of the originating Pi session.",
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = PostalColors.warningForeground
            )
        }
        QuestionChatConnectionStatus(connection = connection, onRetry = onRetry)
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (showStarters) {
                    Text(
                        text = "Ask what you need to understand this decision.",
                        fontSize = 14.sp,
                        color = PostalColors.muted,
                        lineHeight = 20.sp
                    )
                }
                snapshot.messages.forEach { message ->
                    QuestionChatMessageBubble(
                        message = message,
                        renderedAssistantMessage = owner.renderedAssistantMessages[message.id],
                        onLinkClick = onLinkClick,
                        onCopyCode = onCopyCode
                    )
                }
                snapshot.tools.takeIf { it.isNotEmpty() }?.let { tools ->
                    QuestionChatToolRows(tools = tools, onReviewSuggestion = onReviewSuggestion)
                }
            }
        }
        if (showStarters) {
            StarterButtons(enabled = canInteract, onSendStarter = onSendStarter)
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(composerInsetModifier),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                OutlinedTextField(
                    value = owner.draftText,
                    onValueChange = onDraftChanged,
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester)
                        .semantics { contentDescription = "Message Question Chat" },
                    minLines = 2,
                    maxLines = 4,
                    enabled = canInteract,
                    placeholder = { Text("Ask about this decision…") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PostalColors.border,
                        unfocusedBorderColor = PostalColors.border,
                        focusedContainerColor = PostalColors.elevated,
                        unfocusedContainerColor = PostalColors.elevated,
                        disabledContainerColor = PostalColors.surface,
                        cursorColor = PostalColors.attention,
                        focusedPlaceholderColor = PostalColors.muted,
                        unfocusedPlaceholderColor = PostalColors.muted,
                        focusedTextColor = PostalColors.text,
                        unfocusedTextColor = PostalColors.text,
                        disabledTextColor = PostalColors.muted
                    )
                )
                QuestionChatSendBubble(
                    label = if (snapshot.state == QuestionChatState.GENERATING) "Steer" else "Send",
                    enabled = canSend,
                    onClick = onSendDraft
                )
            }
            if (showStop) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    OutlinedButton(
                        onClick = onStop,
                        enabled = canInteract && owner.pendingStopCommandId == null && snapshot.state == QuestionChatState.GENERATING,
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) {
                        Text(if (owner.pendingStopCommandId != null || snapshot.state == QuestionChatState.STOPPING) "Stopping…" else "Stop")
                    }
                }
            }
            owner.actionMessage?.let { message ->
                Text(
                    text = message,
                    color = if (owner.actionUnavailable != null) PostalColors.dangerForeground else PostalColors.muted,
                    fontSize = 12.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
            QuestionChatModelDisclosure(snapshot)
        }
    }
}

@Composable
private fun QuestionChatSendBubble(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        contentPadding = PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = PostalColors.attention,
            contentColor = PostalColors.attentionContrast,
            disabledContainerColor = PostalColors.attention.copy(alpha = 0.35f),
            disabledContentColor = PostalColors.attentionContrast.copy(alpha = 0.8f)
        ),
        modifier = Modifier
            .size(52.dp)
            .testTag(QUESTION_CHAT_SEND_BUTTON_TEST_TAG)
            .semantics { contentDescription = label }
    ) {
        Icon(
            imageVector = PaperPlaneIcon,
            contentDescription = null,
            tint = PostalColors.attentionContrast,
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun QuestionChatConnectionStatus(
    connection: QuestionChatConnectionState,
    onRetry: () -> Unit
) {
    val label = when (connection) {
        QuestionChatConnectionState.OFFLINE -> "Chat offline · showing last synchronized messages"
        QuestionChatConnectionState.SYNCHRONIZING -> "Chat stale · resynchronizing"
        QuestionChatConnectionState.TERMINAL -> "Chat ended"
        QuestionChatConnectionState.ONLINE -> null
    } ?: return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            color = if (connection == QuestionChatConnectionState.TERMINAL) PostalColors.dangerForeground else PostalColors.warningForeground,
            fontSize = 13.sp,
            modifier = Modifier
                .weight(1f)
                .semantics { liveRegion = LiveRegionMode.Polite }
        )
        if (connection != QuestionChatConnectionState.TERMINAL) {
            Spacer(modifier = Modifier.width(8.dp))
            TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("Retry")
            }
        }
    }
}

@Composable
private fun QuestionChatActivationWorkspace(message: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = message,
            fontSize = 14.sp,
            color = PostalColors.subtle,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
        )
    }
}

@Composable
private fun QuestionChatUnavailableWorkspace(
    error: QuestionChatAvailabilityError,
    onRetry: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = error.message,
            fontSize = 14.sp,
            color = PostalColors.dangerForeground
        )
        questionChatContextUnavailableMessage(error)?.let { message ->
            Text(
                text = message,
                fontSize = 13.sp,
                color = PostalColors.subtle,
                lineHeight = 19.sp
            )
        }
        OutlinedButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("Retry")
        }
    }
}

@Composable
private fun QuestionChatAvailabilityWorkspace(
    error: QuestionChatAvailabilityError,
    contextOnlyConfirmationVisible: Boolean,
    onShowContextOnlyConfirmation: () -> Unit,
    onDismissContextOnlyConfirmation: () -> Unit,
    onConfirmContextOnlyQuestionChat: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = error.message,
            fontSize = 14.sp,
            color = PostalColors.dangerForeground
        )
        OutlinedButton(onClick = onShowContextOnlyConfirmation, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("Start context-only interviewer")
        }
        if (contextOnlyConfirmationVisible) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Start context-only interviewer?",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = PostalColors.text
                )
                Text(
                    text = "This starts a fresh private interviewer session from persisted handoff context. It is not an exact fork of the originating Pi Session.",
                    fontSize = 14.sp,
                    color = PostalColors.subtle,
                    lineHeight = 20.sp
                )
                OutlinedButton(onClick = onConfirmContextOnlyQuestionChat, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("Confirm context-only interviewer")
                }
                TextButton(onClick = onDismissContextOnlyConfirmation, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("Cancel context-only interviewer")
                }
            }
        }
    }
}

private fun questionChatContextUnavailableMessage(error: QuestionChatAvailabilityError): String? {
    val contextFallback = error.contextFallback as? QuestionChatContextFallbackAvailability.Unavailable ?: return null
    return when (contextFallback.reason) {
        "missing_codebase_context" -> "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted codebase context."
        "missing_problem_context" -> "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted problem context."
        else -> "The context-only interviewer is unavailable because this legacy Postbox Question has no persisted codebase or problem context."
    }
}

private fun questionChatWorkspaceBorderColor(
    activation: QuestionChatActivationUiState,
    connection: QuestionChatConnectionState?
): Color = if (connection == QuestionChatConnectionState.ONLINE) {
    PostalColors.success
} else {
    when (activation) {
        QuestionChatActivationUiState.Probing,
        QuestionChatActivationUiState.ActivatingExact,
        QuestionChatActivationUiState.ActivatingContextFallback,
        QuestionChatActivationUiState.Idle,
        is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation,
        is QuestionChatActivationUiState.Unavailable -> PostalColors.danger
    }
}

private fun questionChatWorkspaceStatusDescription(
    activation: QuestionChatActivationUiState,
    connection: QuestionChatConnectionState?
): String = when (connection) {
    QuestionChatConnectionState.ONLINE -> "Chat connected and usable"
    QuestionChatConnectionState.OFFLINE -> "Chat offline"
    QuestionChatConnectionState.SYNCHRONIZING -> "Chat stale"
    QuestionChatConnectionState.TERMINAL -> "Chat ended"
    null -> when (activation) {
        QuestionChatActivationUiState.Probing -> "Checking for an existing Chat"
        QuestionChatActivationUiState.ActivatingExact,
        QuestionChatActivationUiState.ActivatingContextFallback,
        QuestionChatActivationUiState.Idle -> "Starting Chat"
        is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation -> "Chat exact activation unavailable"
        is QuestionChatActivationUiState.Unavailable -> "Chat unavailable"
    }
}

@Composable
private fun QuestionChatModelDisclosure(snapshot: QuestionChatSnapshot) {
    Text(
        text = buildString {
            append("Model: ")
            append(snapshot.model.id)
            if (snapshot.model.source == QuestionChatModelSource.PI_DEFAULT) append(" · Pi default fallback")
        },
        fontSize = 12.sp,
        color = PostalColors.muted
    )
    snapshot.model.fallbackReason?.let {
        Text(it, fontSize = 12.sp, color = PostalColors.warningForeground)
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
            OutlinedButton(
                onClick = { onSendStarter(starter) },
                enabled = enabled,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.heightIn(min = 48.dp)
            ) {
                Text(text = label, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun QuestionChatMessageBubble(
    message: QuestionChatMessage,
    renderedAssistantMessage: QuestionChatRenderedAssistantMessage?,
    onLinkClick: (String) -> Unit,
    onCopyCode: (String) -> Unit
) {
    val isUser = message is QuestionChatMessage.User
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(if (isUser) 0.86f else 0.92f)
                .background(
                    if (isUser) PostalColors.attention.copy(alpha = 0.1f) else PostalColors.elevated,
                    RoundedCornerShape(12.dp)
                )
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            when (message) {
                is QuestionChatMessage.User -> SelectionContainer {
                    Text(text = message.text, color = PostalColors.text, lineHeight = 21.sp)
                }
                is QuestionChatMessage.Assistant -> {
                    val rich = renderedAssistantMessage?.rendered
                    if (message.status == QuestionChatMessage.Assistant.Status.STREAMING || rich == null) {
                        SelectionContainer { Text(text = message.text, color = PostalColors.subtle, lineHeight = 21.sp) }
                    } else {
                        when (rich) {
                            is SafeMarkdownRenderResult.PlainTextFallback -> {
                                if (rich.formattingUnavailable) {
                                    Text("Formatting unavailable", color = PostalColors.muted, fontSize = 12.sp)
                                }
                                SelectionContainer { Text(text = rich.text, color = PostalColors.subtle, lineHeight = 21.sp) }
                            }
                            is SafeMarkdownRenderResult.Rich -> SafeMarkdownDocumentView(
                                document = rich.document,
                                onLinkClick = onLinkClick,
                                onCopyCode = onCopyCode
                            )
                        }
                    }
                    when (message.status) {
                        QuestionChatMessage.Assistant.Status.STOPPED -> Text(
                            text = "Stopped",
                            color = PostalColors.warningForeground,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                        QuestionChatMessage.Assistant.Status.INTERRUPTED -> Text(
                            text = "Interrupted",
                            color = PostalColors.dangerForeground,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                        else -> Unit
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestionChatToolRows(
    tools: List<QuestionChatToolActivity>,
    onReviewSuggestion: (String) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        tools.forEach { tool ->
            QuestionChatToolRow(tool = tool, onReviewSuggestion = onReviewSuggestion)
        }
    }
}

@Composable
private fun QuestionChatToolRow(
    tool: QuestionChatToolActivity,
    onReviewSuggestion: (String) -> Unit
) {
    var expanded by remember(tool.id) { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, PostalColors.border, RoundedCornerShape(10.dp))
            .background(PostalColors.elevated, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
            Text(
                text = questionChatToolLabel(tool.tool),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = PostalColors.text
            )
            Text(
                text = questionChatToolStateLabel(tool.state),
                fontSize = 12.sp,
                color = PostalColors.muted
            )
        }
        Text(
            text = tool.target,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
            color = PostalColors.subtle,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        if (tool.details != null) {
            TextButton(onClick = { expanded = !expanded }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(if (expanded) "Hide details" else "Details")
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
                        .background(PostalColors.surface, RoundedCornerShape(8.dp))
                        .padding(8.dp)
                )
            }
        }
        tool.actionOptionValue?.takeIf { tool.state == "success" }?.let { optionValue ->
            OutlinedButton(onClick = { onReviewSuggestion(optionValue) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("View in Question")
            }
        }
    }
}

private fun questionChatToolLabel(tool: String): String = when (tool) {
    "repository_read" -> "Read"
    "repository_grep" -> "Grep"
    "repository_find" -> "Find"
    "repository_list" -> "List"
    else -> "Suggested in Chat"
}

private fun questionChatToolStateLabel(state: String): String = when (state) {
    "running" -> "Running"
    "success" -> "Success"
    "error" -> "Error"
    else -> "Interrupted"
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
    val annotated = remember(inlines, onLinkClick) {
        buildQuestionChatMarkdownAnnotatedString(inlines, onLinkClick)
    }
    Text(
        text = annotated,
        modifier = modifier,
        style = androidx.compose.ui.text.TextStyle(
            color = PostalColors.text,
            fontWeight = fontWeight,
            fontSize = fontSize,
            lineHeight = 22.sp
        )
    )
}

internal fun buildQuestionChatMarkdownAnnotatedString(
    inlines: List<SafeMarkdownInline>,
    onLinkClick: (String) -> Unit
): AnnotatedString = buildAnnotatedString {
    fun appendChildren(children: List<SafeMarkdownInline>) {
        children.forEach { inline ->
            when (inline) {
                is SafeMarkdownInline.Text -> append(inline.text)
                is SafeMarkdownInline.Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(inline.text) }
                is SafeMarkdownInline.Emphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { appendChildren(inline.children) }
                is SafeMarkdownInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendChildren(inline.children) }
                is SafeMarkdownInline.Link -> {
                    if (isSafeQuestionChatUrl(inline.url)) {
                        withLink(
                            LinkAnnotation.Url(
                                url = inline.url,
                                styles = TextLinkStyles(style = SpanStyle(color = PostalColors.historyForeground)),
                                linkInteractionListener = LinkInteractionListener { annotation ->
                                    val clickedUrl = (annotation as? LinkAnnotation.Url)?.url ?: return@LinkInteractionListener
                                    if (isSafeQuestionChatUrl(clickedUrl)) {
                                        onLinkClick(clickedUrl)
                                    }
                                }
                            )
                        ) {
                            appendChildren(inline.children)
                        }
                    } else {
                        appendChildren(inline.children)
                    }
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

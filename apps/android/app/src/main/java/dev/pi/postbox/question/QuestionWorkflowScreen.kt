package dev.pi.postbox.question

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.pi.postbox.BuildConfig
import dev.pi.postbox.R
import dev.pi.postbox.protocol.OTHER_OPTION_VALUE
import dev.pi.postbox.ui.theme.CrossIcon
import dev.pi.postbox.ui.theme.EnvelopeIcon
import dev.pi.postbox.ui.theme.MenuIcon
import dev.pi.postbox.ui.theme.PaperPlaneIcon
import dev.pi.postbox.ui.theme.PostalCaptionStyle
import dev.pi.postbox.ui.theme.PostalColors
import dev.pi.postbox.ui.theme.PostalDisplayFontFamily
import dev.pi.postbox.ui.theme.PostboxTheme
import dev.pi.postbox.ui.theme.dashedBorder
import dev.pi.postbox.ui.theme.letterPaper
import dev.pi.postbox.ui.theme.postalStripes
import dev.pi.postbox.ui.theme.stampEdge
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun QuestionWorkflowScreen(
    state: QuestionWorkflowState,
    onShowQueue: () -> Unit,
    onSelectProject: (String) -> Unit,
    onSelectSession: (String) -> Unit,
    onSelectQuestion: (String) -> Unit,
    onToggleOption: (String) -> Unit,
    onSubmitAnswer: (note: String?) -> Unit,
    onCancelQuestion: (note: String?) -> Unit,
    onDismissQuestion: (String) -> Unit,
    onEditServerUrl: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Set when the answer is stamped (submitted); cleared again if the submit errors.
    var stampedRequestId by remember { mutableStateOf<String?>(null) }
    val visibleQuestion = state.visibleQuestion
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(
        stampedRequestId,
        visibleQuestion?.requestId,
        visibleQuestion?.submissionError,
        visibleQuestion?.terminalState
    ) {
        val stamped = stampedRequestId ?: return@LaunchedEffect
        val stampedStillVisible = visibleQuestion?.requestId == stamped
        if (stampedStillVisible && visibleQuestion?.submissionError != null) {
            stampedRequestId = null
        } else if (!stampedStillVisible || visibleQuestion.terminalState != null) {
            // Delivered: hold the stamp briefly, like the web view, before moving on.
            delay(900)
            stampedRequestId = null
        }
    }

    ModalNavigationDrawer(
        modifier = modifier,
        drawerState = drawerState,
        scrimColor = Color.Black.copy(alpha = 0.3f),
        drawerContent = {
            ModalDrawerSheet(
                drawerShape = RectangleShape,
                drawerContainerColor = PostalColors.surface,
                modifier = Modifier
                    .fillMaxWidth(0.85f)
                    .widthIn(max = 352.dp)
            ) {
                NavigationSidebar(
                    state = state,
                    onShowQueue = {
                        onShowQueue()
                        coroutineScope.launch { drawerState.close() }
                    },
                    onSelectProject = { projectId ->
                        onSelectProject(projectId)
                        coroutineScope.launch { drawerState.close() }
                    },
                    onSelectSession = { sessionId ->
                        onSelectSession(sessionId)
                        coroutineScope.launch { drawerState.close() }
                    },
                    onSelectQuestion = { requestId ->
                        onSelectQuestion(requestId)
                        coroutineScope.launch { drawerState.close() }
                    },
                    onDismissQuestion = onDismissQuestion,
                    onEditServerUrl = {
                        coroutineScope.launch { drawerState.close() }
                        onEditServerUrl()
                    }
                )
            }
        }
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(PostalColors.canvas)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                WorkflowTopBar(
                    state = state,
                    onOpenNavigation = { coroutineScope.launch { drawerState.open() } }
                )

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ConnectionNotice(state)

                    state.terminalMessage?.let { message ->
                        PostalMessageCard(
                            title = "Question resolved",
                            body = message.message
                        )
                    }
                    state.errorMessage?.let { error ->
                        PostalMessageCard(
                            title = "Unable to load questions",
                            body = error,
                            tone = PostalMessageTone.DANGER
                        )
                    }

                    if (state.isLoading) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "Loading Postbox questions…",
                                color = PostalColors.subtle
                            )
                        }
                    } else {
                        when (val selection = state.navigationSelection) {
                            QuestionNavigationSelection.Queue -> QuestionQueueView(
                                title = "Questions waiting for you",
                                subtitle = "All pending Postbox decisions, oldest first.",
                                questions = state.pendingQuestions,
                                dismissEnabled = state.dismissingRequestId == null,
                                isSyncing = state.isSyncing,
                                onSelectQuestion = onSelectQuestion,
                                onDismissQuestion = onDismissQuestion,
                                modifier = Modifier.weight(1f)
                            )
                            is QuestionNavigationSelection.Project -> {
                                val sessions = visibleSidebarSessions(state.sessions, state.snapshotTimestamp)
                                    .filter { it.projectId == selection.projectId }
                                val sessionIds = sessions.mapTo(mutableSetOf()) { it.sessionId }
                                QuestionQueueView(
                                    title = sessions.firstOrNull()?.projectName ?: "Project",
                                    subtitle = "Pending Postbox decisions for this project, oldest first.",
                                    questions = state.pendingQuestions.filter { it.sessionId in sessionIds },
                                    dismissEnabled = state.dismissingRequestId == null,
                                    isSyncing = state.isSyncing,
                                    onSelectQuestion = onSelectQuestion,
                                    onDismissQuestion = onDismissQuestion,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            is QuestionNavigationSelection.Session -> {
                                val session = state.sessions.firstOrNull { it.sessionId == selection.sessionId }
                                if (session == null) {
                                    PostalMessageCard(
                                        title = "Session ended",
                                        body = "This Pi session is no longer registered."
                                    )
                                } else {
                                    SessionDetailView(
                                        session = session,
                                        questions = state.pendingQuestions.filter { it.sessionId == session.sessionId },
                                        dismissEnabled = state.dismissingRequestId == null,
                                        onSelectQuestion = onSelectQuestion,
                                        onDismissQuestion = onDismissQuestion,
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }
                            is QuestionNavigationSelection.Question, null -> {
                                if (visibleQuestion == null) {
                                    EmptyQuestionsCard(isSyncing = state.isSyncing)
                                } else {
                                    val session = state.sessions.firstOrNull { it.sessionId == visibleQuestion.sessionId }
                                    val listItem = state.pendingQuestions.firstOrNull { it.requestId == visibleQuestion.requestId }
                                    QuestionDetailCard(
                                        question = visibleQuestion,
                                        projectLabel = session?.projectName ?: "Unknown project",
                                        branchLabel = session?.branch ?: "Unknown branch",
                                        askedAgo = listItem?.createdAt?.let(::formatTimeAgo),
                                        onToggleOption = onToggleOption,
                                        onSubmitAnswer = { note ->
                                            stampedRequestId = visibleQuestion.requestId
                                            onSubmitAnswer(note)
                                        },
                                        onCancelQuestion = onCancelQuestion,
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }
                        }
                    }
                }

                // Airmail envelope edge pinned along the bottom of the screen,
                // resting above the gesture navigation area.
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .height(3.dp)
                        .alpha(0.7f)
                        .postalStripes()
                )
            }

            if (stampedRequestId != null) {
                DeliveredStampOverlay(
                    delivering = visibleQuestion?.requestId == stampedRequestId && visibleQuestion?.isSubmitting == true,
                    onDismiss = { stampedRequestId = null }
                )
            }
        }
    }
}

/** Mobile top bar like the web: hamburger toggle, status dot, and the postal masthead. */
@Composable
private fun WorkflowTopBar(
    state: QuestionWorkflowState,
    onOpenNavigation: () -> Unit
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(PostalColors.surface)
                // Extend the surface color under the translucent status bar, but keep
                // the bar content (hamburger, masthead) below it.
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, PostalColors.border, RoundedCornerShape(8.dp))
                    .background(PostalColors.elevated)
                    .clickable(onClick = onOpenNavigation),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = MenuIcon,
                    contentDescription = "Open navigation",
                    tint = PostalColors.subtle,
                    modifier = Modifier.size(18.dp)
                )
            }
            ConnectionStatusDot(state.connectionState)
            Text(
                text = "Pi Postbox",
                style = MaterialTheme.typography.headlineSmall,
                color = PostalColors.attention,
                modifier = Modifier.weight(1f)
            )
            if (state.pendingQuestions.isNotEmpty()) {
                OpenCountPill(count = state.pendingQuestions.size)
            }
        }
        HorizontalDivider(color = PostalColors.border)
    }
}

@Composable
private fun OpenCountPill(count: Int) {
    Text(
        text = "$count open",
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = PostalColors.attentionForeground,
        modifier = Modifier
            .clip(CircleShape)
            .background(PostalColors.attention.copy(alpha = 0.1f))
            .border(1.dp, PostalColors.attentionBorder, CircleShape)
            .padding(horizontal = 10.dp, vertical = 2.dp)
    )
}

@Composable
private fun ConnectionNotice(state: QuestionWorkflowState) {
    if (state.connectionState == QuestionConnectionState.CONNECTED) return
    val connectionText = when (state.connectionState) {
        QuestionConnectionState.CONNECTING -> "Connecting"
        QuestionConnectionState.DISCONNECTED -> "Disconnected"
        QuestionConnectionState.ERROR -> "Connection error"
        QuestionConnectionState.CONNECTED -> ""
    }
    Text(
        text = state.connectionMessage?.let { "$connectionText: $it" } ?: connectionText,
        style = MaterialTheme.typography.bodySmall,
        color = if (state.connectionState == QuestionConnectionState.ERROR) {
            PostalColors.dangerForeground
        } else {
            PostalColors.warningForeground
        }
    )
}

@Composable
private fun ConnectionStatusDot(connectionState: QuestionConnectionState) {
    val color = when (connectionState) {
        QuestionConnectionState.CONNECTED -> PostalColors.success
        QuestionConnectionState.CONNECTING -> PostalColors.borderStrong
        QuestionConnectionState.DISCONNECTED -> PostalColors.warning
        QuestionConnectionState.ERROR -> PostalColors.danger
    }
    Box(
        modifier = Modifier
            .size(8.dp)
            .background(color, CircleShape)
    )
}

/**
 * Sidebar drawer mirroring the web dashboard: masthead on top, sessions and
 * their open questions grouped by project in the middle, server controls
 * pinned to the bottom.
 */
@Composable
private fun NavigationSidebar(
    state: QuestionWorkflowState,
    onShowQueue: () -> Unit,
    onSelectProject: (String) -> Unit,
    onSelectSession: (String) -> Unit,
    onSelectQuestion: (String) -> Unit,
    onDismissQuestion: (String) -> Unit,
    onEditServerUrl: () -> Unit
) {
    val groups = remember(state.sessions, state.pendingQuestions, state.snapshotTimestamp) {
        buildSidebarGroups(state.sessions, state.pendingQuestions, state.snapshotTimestamp)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        val queueSelected = state.navigationSelection == QuestionNavigationSelection.Queue
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (queueSelected) PostalColors.attention.copy(alpha = 0.08f) else Color.Transparent)
                .clickable(onClickLabel = "Show all open questions", onClick = onShowQueue)
                .semantics { selected = queueSelected }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            ConnectionStatusDot(state.connectionState)
            Text(
                text = "Pi Postbox",
                fontFamily = PostalDisplayFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = PostalColors.attention,
                modifier = Modifier.weight(1f)
            )
            OpenCountPill(count = state.pendingQuestions.size)
        }
        HorizontalDivider(color = PostalColors.border)

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            state.dismissError?.let { error ->
                Text(
                    text = error,
                    fontSize = 12.sp,
                    color = PostalColors.dangerForeground,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(PostalColors.danger.copy(alpha = 0.1f))
                        .padding(8.dp)
                )
            }

            if (state.isLoading) {
                Text(
                    text = "Loading sessions…",
                    style = MaterialTheme.typography.bodySmall,
                    color = PostalColors.muted,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp)
                )
            } else if (groups.isEmpty()) {
                Text(
                    text = "No active Pi sessions. Start Pi with the Postbox extension configured to this server.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PostalColors.muted,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp)
                )
            } else {
                groups.forEach { group ->
                    SidebarProjectSection(
                        group = group,
                        navigationSelection = state.navigationSelection,
                        dismissEnabled = state.dismissingRequestId == null,
                        onSelectProject = onSelectProject,
                        onSelectSession = onSelectSession,
                        onSelectQuestion = onSelectQuestion,
                        onDismissQuestion = onDismissQuestion
                    )
                }
            }
        }

        HorizontalDivider(color = PostalColors.border)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            state.notificationStatusMessage?.let { statusMessage ->
                Text(
                    text = statusMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = PostalColors.muted
                )
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, PostalColors.border, RoundedCornerShape(8.dp))
                    .background(PostalColors.elevated)
                    .clickable(onClick = onEditServerUrl)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = "Edit server URL",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = PostalColors.subtle
                )
                Text(
                    text = state.baseUrl,
                    fontSize = 11.sp,
                    color = PostalColors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                text = "v${BuildConfig.VERSION_NAME} · build ${BuildConfig.VERSION_CODE}",
                fontSize = 10.sp,
                color = PostalColors.muted,
                modifier = Modifier.padding(horizontal = 4.dp)
            )
        }
    }
}

/**
 * One project row like the web sidebar: project name on the left, one activity
 * dot per session on the right, and the project's open questions underneath.
 */
@Composable
private fun SidebarProjectSection(
    group: SidebarProjectGroup,
    navigationSelection: QuestionNavigationSelection?,
    dismissEnabled: Boolean,
    onSelectProject: (String) -> Unit,
    onSelectSession: (String) -> Unit,
    onSelectQuestion: (String) -> Unit,
    onDismissQuestion: (String) -> Unit
) {
    val hasProjectDestination = group.sessions.isNotEmpty()
    val projectSelected = navigationSelection == QuestionNavigationSelection.Project(group.projectId)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = group.projectName.uppercase(),
                style = PostalCaptionStyle.copy(color = PostalColors.text),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (projectSelected) PostalColors.attention.copy(alpha = 0.08f) else Color.Transparent)
                    .then(
                        if (hasProjectDestination) {
                            Modifier
                                .clickable(
                                    onClickLabel = "Show open questions for ${group.projectName}",
                                    onClick = { onSelectProject(group.projectId) }
                                )
                                .semantics { selected = projectSelected }
                        } else {
                            Modifier
                        }
                    )
                    .padding(horizontal = 8.dp, vertical = 16.dp)
            )
            if (group.sessions.size > MAX_INDIVIDUAL_SESSION_DOTS) {
                AggregateSessionIndicator(
                    group = group,
                    selected = projectSelected,
                    onClick = { onSelectProject(group.projectId) }
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    group.sessions.forEach { session ->
                        val hasOpenQuestion = group.questions.any { it.sessionId == session.sessionId }
                        val sessionSelected = navigationSelection ==
                            QuestionNavigationSelection.Session(session.sessionId)
                        val label = sidebarSessionLabel(session)
                        val status = sessionStatusLabel(session, hasOpenQuestion)
                        Box(
                            modifier = Modifier
                                // 12dp dot in a 24dp slot: the visible gap equals one dot diameter.
                                .width(24.dp)
                                .height(48.dp)
                                .clickable(
                                    onClickLabel = "Show session $label",
                                    onClick = { onSelectSession(session.sessionId) }
                                )
                                .semantics {
                                    contentDescription = "$label — $status"
                                    selected = sessionSelected
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (sessionSelected) {
                                            PostalColors.attention.copy(alpha = 0.1f)
                                        } else {
                                            Color.Transparent
                                        }
                                    )
                                    .border(
                                        width = 1.dp,
                                        color = if (sessionSelected) {
                                            PostalColors.attentionBorder
                                        } else {
                                            Color.Transparent
                                        },
                                        shape = CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(12.dp)
                                        .background(sessionDotColor(session, hasOpenQuestion), CircleShape)
                                )
                            }
                        }
                    }
                }
            }
        }
        group.questions.forEach { question ->
            QuestionListItem(
                question = question,
                selected = navigationSelection == QuestionNavigationSelection.Question(question.requestId),
                dismissEnabled = dismissEnabled,
                onClick = { onSelectQuestion(question.requestId) },
                onDismiss = { onDismissQuestion(question.requestId) }
            )
        }
    }
}

/**
 * Same semantics as the web sidebar dot: red needs you, green is working,
 * blue is done/idle, gray is offline or unknown.
 */
private fun sessionDotColor(session: QuestionSessionUiState, hasOpenQuestion: Boolean): Color = when {
    session.presence == "offline" -> PostalColors.borderStrong
    hasOpenQuestion || session.semanticState == "blocked" -> PostalColors.attention
    session.semanticState == "working" -> PostalColors.success
    session.semanticState == "idle" -> PostalColors.history
    else -> PostalColors.borderStrong
}

private fun sidebarSessionLabel(session: QuestionSessionUiState): String =
    session.branch ?: session.title ?: session.sessionId.take(8)

private fun sessionStatusLabel(session: QuestionSessionUiState, hasOpenQuestion: Boolean): String = when {
    session.presence == "offline" -> "Offline"
    hasOpenQuestion || session.semanticState == "blocked" -> "Needs you"
    session.semanticState == "working" -> "Working"
    session.semanticState == "idle" -> "Done"
    else -> "Unknown status"
}

internal const val MAX_INDIVIDUAL_SESSION_DOTS = 3

internal enum class AggregateSessionStatus {
    BLOCKED,
    WORKING,
    IDLE,
    OFFLINE
}

/** Blocked wins over working so the aggregate never hides an agent that needs attention. */
internal fun aggregateSessionStatus(sessions: List<QuestionSessionUiState>): AggregateSessionStatus {
    val onlineSessions = sessions.filter { it.presence != "offline" }
    return when {
        onlineSessions.any { it.semanticState == "blocked" } -> AggregateSessionStatus.BLOCKED
        onlineSessions.any { it.semanticState == "working" } -> AggregateSessionStatus.WORKING
        onlineSessions.any { it.semanticState == "idle" } -> AggregateSessionStatus.IDLE
        else -> AggregateSessionStatus.OFFLINE
    }
}

@Composable
private fun AggregateSessionIndicator(
    group: SidebarProjectGroup,
    selected: Boolean,
    onClick: () -> Unit
) {
    val status = aggregateSessionStatus(group.sessions)
    val statusLabel = when (status) {
        AggregateSessionStatus.BLOCKED -> "At least one agent needs you"
        AggregateSessionStatus.WORKING -> "At least one agent is working"
        AggregateSessionStatus.IDLE -> "Agents are idle"
        AggregateSessionStatus.OFFLINE -> "Agents are offline"
    }
    val dotColor = when (status) {
        AggregateSessionStatus.BLOCKED -> PostalColors.attention
        AggregateSessionStatus.WORKING -> PostalColors.success
        AggregateSessionStatus.IDLE -> PostalColors.history
        AggregateSessionStatus.OFFLINE -> PostalColors.borderStrong
    }

    Row(
        modifier = Modifier
            .height(48.dp)
            .clip(CircleShape)
            .background(if (selected) PostalColors.attention.copy(alpha = 0.1f) else Color.Transparent)
            .border(
                width = 1.dp,
                color = if (selected) PostalColors.attentionBorder else Color.Transparent,
                shape = CircleShape
            )
            .clickable(
                onClickLabel = "Show sessions for ${group.projectName}",
                onClick = onClick
            )
            .semantics {
                contentDescription = "${group.sessions.size} sessions — $statusLabel"
                this.selected = selected
            }
            .padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = group.sessions.size.toString(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = PostalColors.subtle
        )
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(dotColor, CircleShape)
        )
    }
}

internal data class SidebarProjectGroup(
    val projectId: String,
    val projectName: String,
    val sessions: List<QuestionSessionUiState>,
    val questions: List<QuestionListItemUiState>
)

internal const val SIDEBAR_RECENT_OFFLINE_WINDOW_MS = 5L * 60L * 1000L

/**
 * Mirrors the web sidebar: offline sessions stay listed only for a short
 * window after disconnecting, then disappear from the drawer.
 */
internal fun isSidebarSessionVisible(
    session: QuestionSessionUiState,
    snapshotTimestamp: String?
): Boolean {
    if (session.presence != "offline") return true
    val snapshotTime = snapshotTimestamp?.let(::parseInstant) ?: return false
    val disconnectedTime = session.disconnectedAt?.let(::parseInstant) ?: return false
    return Duration.between(disconnectedTime, snapshotTime).toMillis() < SIDEBAR_RECENT_OFFLINE_WINDOW_MS
}

/** Groups visible sessions by project and attaches each project's open questions. */
internal fun visibleSidebarSessions(
    sessions: List<QuestionSessionUiState>,
    snapshotTimestamp: String?
): List<QuestionSessionUiState> = sessions.filter { isSidebarSessionVisible(it, snapshotTimestamp) }

internal fun buildSidebarGroups(
    sessions: List<QuestionSessionUiState>,
    questions: List<QuestionListItemUiState>,
    snapshotTimestamp: String?
): List<SidebarProjectGroup> {
    val groups = visibleSidebarSessions(sessions, snapshotTimestamp)
        .groupBy { it.projectId }
        .map { (projectId, projectSessions) ->
            val sessionIds = projectSessions.map { it.sessionId }.toSet()
            SidebarProjectGroup(
                projectId = projectId,
                projectName = projectSessions.first().projectName,
                sessions = projectSessions.sortedBy { it.branch ?: it.title ?: it.sessionId },
                questions = questions
                    .filter { it.sessionId in sessionIds }
                    .sortedBy { parseInstant(it.createdAt) ?: Instant.MAX }
            )
        }
        .sortedBy { it.projectName }
    val claimed = groups.flatMapTo(mutableSetOf()) { group -> group.questions.map { it.requestId } }
    val orphans = questions.filter { it.requestId !in claimed }
    return if (orphans.isEmpty()) {
        groups
    } else {
        groups + SidebarProjectGroup(
            projectId = "__other_questions__",
            projectName = "Other questions",
            sessions = emptyList(),
            questions = orphans.sortedBy { parseInstant(it.createdAt) ?: Instant.MAX }
        )
    }
}

@Composable
private fun QuestionListItem(
    question: QuestionListItemUiState,
    selected: Boolean,
    dismissEnabled: Boolean,
    onClick: () -> Unit,
    onDismiss: () -> Unit
) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(shape)
                .background(
                    if (selected) {
                        PostalColors.attention.copy(alpha = 0.05f).compositeOver(PostalColors.elevated)
                    } else {
                        PostalColors.elevated
                    }
                )
                .border(1.dp, if (selected) PostalColors.attentionBorder else PostalColors.elevated, shape)
                .clickable(onClickLabel = "Open question", onClick = onClick)
                .semantics { this.selected = selected }
                .heightIn(min = 56.dp)
                .padding(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier
                    .padding(top = 5.dp)
                    .size(8.dp)
                    .background(PostalColors.attention, CircleShape)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = question.prompt,
                    fontSize = 14.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    color = PostalColors.text,
                    lineHeight = 19.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = listOfNotNull(
                        if (question.mode == QuestionMode.SINGLE) "Single choice" else "Multiple choice",
                        "asked ${formatTimeAgo(question.createdAt)}"
                    ).joinToString(" · "),
                    fontSize = 12.sp,
                    color = PostalColors.muted
                )
            }
        }
        // Manual escape hatch for stuck questions: cancels without answering.
        Box(
            modifier = Modifier
                .padding(start = 2.dp)
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .alpha(if (dismissEnabled) 1f else 0.5f)
                .clip(CircleShape)
                .clickable(
                    enabled = dismissEnabled,
                    onClickLabel = "Dismiss question",
                    onClick = onDismiss
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = CrossIcon,
                contentDescription = "Dismiss question: ${question.prompt}",
                tint = PostalColors.muted,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

@Composable
private fun QuestionQueueView(
    title: String,
    subtitle: String,
    questions: List<QuestionListItemUiState>,
    dismissEnabled: Boolean,
    onSelectQuestion: (String) -> Unit,
    onDismissQuestion: (String) -> Unit,
    modifier: Modifier = Modifier,
    isSyncing: Boolean = false
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontFamily = PostalDisplayFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = PostalColors.text
                )
                Text(
                    text = subtitle,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = PostalColors.subtle,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            OpenCountPill(count = questions.size)
        }

        if (questions.isEmpty()) {
            EmptyQuestionsCard(isSyncing = isSyncing)
        } else {
            questions.forEach { question ->
                QuestionListItem(
                    question = question,
                    selected = false,
                    dismissEnabled = dismissEnabled,
                    onClick = { onSelectQuestion(question.requestId) },
                    onDismiss = { onDismissQuestion(question.requestId) }
                )
            }
        }
    }
}

@Composable
private fun SessionDetailView(
    session: QuestionSessionUiState,
    questions: List<QuestionListItemUiState>,
    dismissEnabled: Boolean,
    onSelectQuestion: (String) -> Unit,
    onDismissQuestion: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val hasOpenQuestion = questions.isNotEmpty()
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(sessionDotColor(session, hasOpenQuestion), CircleShape)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = sidebarSessionLabel(session),
                    fontFamily = PostalDisplayFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = PostalColors.text
                )
                Text(
                    text = "${session.projectName} · ${sessionStatusLabel(session, hasOpenQuestion)}",
                    fontSize = 14.sp,
                    color = PostalColors.subtle
                )
            }
        }

        PostalPanel {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                LabeledBlock("Machine", session.machineName)
                LabeledBlock("Project", session.projectName)
                LabeledBlock("Branch", session.branch ?: "unknown")
                LabeledBlock(
                    "State",
                    if (session.semanticState == "blocked") "blocked / waiting" else session.semanticState
                )
                LabeledBlock("Presence", session.presence)
            }
        }

        Text(
            text = "Open questions".uppercase(),
            style = PostalCaptionStyle.copy(color = PostalColors.attentionForeground)
        )
        if (questions.isEmpty()) {
            Text(
                text = "This session has no open questions.",
                fontSize = 14.sp,
                color = PostalColors.muted
            )
        } else {
            questions.forEach { question ->
                QuestionListItem(
                    question = question,
                    selected = false,
                    dismissEnabled = dismissEnabled,
                    onClick = { onSelectQuestion(question.requestId) },
                    onDismiss = { onDismissQuestion(question.requestId) }
                )
            }
        }
    }
}

@Composable
private fun QuestionDetailCard(
    question: QuestionDetailUiState,
    projectLabel: String,
    branchLabel: String,
    askedAgo: String?,
    onToggleOption: (String) -> Unit,
    onSubmitAnswer: (note: String?) -> Unit,
    onCancelQuestion: (note: String?) -> Unit,
    modifier: Modifier = Modifier
) {
    var note by remember(question.requestId) { mutableStateOf("") }
    var showNote by remember(question.requestId) { mutableStateOf(false) }
    var showHandoffContext by remember(question.requestId) { mutableStateOf(false) }
    val actionsEnabled = question.terminalState == null && !question.isSubmitting

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(color = PostalColors.subtle, fontWeight = FontWeight.Medium)) {
                        append("Project: ")
                    }
                    append(projectLabel)
                    withStyle(SpanStyle(color = PostalColors.attention)) { append("  •  ") }
                    withStyle(SpanStyle(color = PostalColors.subtle, fontWeight = FontWeight.Medium)) {
                        append("Branch: ")
                    }
                    append(branchLabel)
                },
                fontSize = 12.sp,
                color = PostalColors.muted,
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "ⓘ Context",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = if (showHandoffContext) PostalColors.attentionForeground else PostalColors.subtle,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(PostalColors.elevated)
                    .border(
                        1.dp,
                        if (showHandoffContext) PostalColors.attentionBorder else PostalColors.border,
                        CircleShape
                    )
                    .clickable { showHandoffContext = !showHandoffContext }
                    .padding(horizontal = 12.dp, vertical = 5.dp)
            )
        }

        if (showHandoffContext) {
            HandoffContextSection(question)
        }

        // Letter strip: the question arrives on a piece of ruled writing paper.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(2.dp, RoundedCornerShape(6.dp), ambientColor = PostalColors.shadow, spotColor = PostalColors.shadow)
                .clip(RoundedCornerShape(6.dp))
                .letterPaper()
        ) {
            Text(
                text = question.prompt,
                fontFamily = PostalDisplayFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                lineHeight = 24.sp,
                color = PostalColors.text,
                modifier = Modifier.padding(start = 48.dp, top = 24.dp, end = 20.dp, bottom = 24.dp)
            )
        }

        question.terminalState?.let { terminalState ->
            PostalMessageCard(
                title = "Question resolved",
                body = terminalState.name.lowercase().replace('_', ' ')
            )
        }

        if (question.questionContext != null || question.relevance != null || question.decisionImpact != null) {
            DecisionContextBox(
                context = question.questionContext,
                relevance = question.relevance,
                impact = question.decisionImpact
            )
        }

        Text(
            text = listOfNotNull(
                if (question.mode == QuestionMode.SINGLE) "Choose one" else "Choose one or more",
                askedAgo?.let { "asked $it" }
            ).joinToString(" · ").uppercase(),
            style = PostalCaptionStyle
        )

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            question.options.forEach { option ->
                BallotOptionRow(
                    option = option,
                    selected = question.selectedValues.contains(option.value),
                    enabled = actionsEnabled,
                    onToggle = {
                        onToggleOption(option.value)
                        if (option.value == OTHER_OPTION_VALUE) showNote = true
                    }
                )
            }

            if (question.options.none { it.value == OTHER_OPTION_VALUE }) {
                BallotOptionRow(
                    option = QuestionOptionUiState(
                        value = OTHER_OPTION_VALUE,
                        label = "Other",
                        description = "Choose this when none of the listed answers fit. A note box will open below."
                    ),
                    selected = question.selectedValues.contains(OTHER_OPTION_VALUE),
                    enabled = actionsEnabled,
                    dashed = true,
                    onToggle = {
                        onToggleOption(OTHER_OPTION_VALUE)
                        showNote = true
                    }
                )
            }
        }

        if (showNote) {
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = note,
                onValueChange = { note = it },
                label = { Text("Add nuance for the coding agent…") },
                enabled = actionsEnabled,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PostalColors.attentionBorder,
                    unfocusedBorderColor = PostalColors.border,
                    focusedContainerColor = PostalColors.elevated,
                    unfocusedContainerColor = PostalColors.elevated,
                    disabledContainerColor = PostalColors.surface,
                    cursorColor = PostalColors.attention,
                    focusedLabelColor = PostalColors.subtle,
                    unfocusedLabelColor = PostalColors.muted,
                    focusedTextColor = PostalColors.text,
                    unfocusedTextColor = PostalColors.text
                ),
                minLines = 2
            )
        }

        question.submissionError?.let { error ->
            Text(
                text = error,
                fontSize = 14.sp,
                color = PostalColors.dangerForeground,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(PostalColors.danger.copy(alpha = 0.1f))
                    .padding(12.dp)
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp, bottom = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            PostalSubmitButton(
                enabled = actionsEnabled && question.canSubmit,
                onClick = { onSubmitAnswer(note.nullIfBlank()) }
            )
            SubtleTextButton(
                text = if (showNote) "Hide note" else "+ Add a note",
                enabled = true,
                onClick = { showNote = !showNote }
            )
            SubtleTextButton(
                text = "Cancel",
                enabled = actionsEnabled && question.availableActions.contains(QuestionAction.CANCEL),
                onClick = { onCancelQuestion(note.nullIfBlank()) }
            )
        }
    }
}

/** Postal double frame with a navy envelope stamp: "Why this decision matters". */
@Composable
private fun DecisionContextBox(
    context: String?,
    relevance: String?,
    impact: String?
) {
    val hasMore = relevance != null || impact != null
    var expanded by remember { mutableStateOf(false) }
    val outerShape = RoundedCornerShape(10.dp)
    val innerShape = RoundedCornerShape(7.dp)
    val chevronAngle by animateFloatAsState(if (expanded) 180f else 0f, label = "chevron")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(outerShape)
            .background(PostalColors.history.copy(alpha = 0.05f))
            .border(2.dp, PostalColors.history.copy(alpha = 0.5f), outerShape)
            .padding(3.dp)
            .border(1.dp, PostalColors.history.copy(alpha = 0.4f), innerShape)
            .clickable(enabled = hasMore) { expanded = !expanded }
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier
                    .padding(top = 2.dp)
                    .stampEdge()
                    .clip(RoundedCornerShape(2.dp))
                    .background(PostalColors.history)
                    .size(36.dp),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = EnvelopeIcon,
                    contentDescription = null,
                    tint = PostalColors.elevated,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Why this decision matters".uppercase(),
                        style = PostalCaptionStyle.copy(color = PostalColors.historyForeground),
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (hasMore) {
                        Text(
                            text = "▾",
                            color = PostalColors.historyForeground,
                            modifier = Modifier.rotate(chevronAngle)
                        )
                    }
                }
                context?.let {
                    Text(
                        text = it,
                        fontSize = 14.sp,
                        lineHeight = 21.sp,
                        color = PostalColors.subtle,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }
        if (expanded) {
            Column(
                modifier = Modifier.padding(start = 48.dp, top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                relevance?.let { LabeledBlock("Relevance", it) }
                impact?.let { LabeledBlock("Impact", it) }
            }
        }
    }
}

/** Ballot-style option row: round mark, hairline divider, serif label. */
@Composable
private fun BallotOptionRow(
    option: QuestionOptionUiState,
    selected: Boolean,
    enabled: Boolean,
    onToggle: () -> Unit,
    dashed: Boolean = false
) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(
                when {
                    selected -> PostalColors.attention.copy(alpha = 0.05f).compositeOver(PostalColors.elevated)
                    dashed -> PostalColors.elevated.copy(alpha = 0.6f).compositeOver(PostalColors.canvas)
                    else -> PostalColors.elevated
                }
            )
            .then(
                if (dashed && !selected) {
                    Modifier.dashedBorder(PostalColors.borderStrong, cornerRadius = 8.dp)
                } else {
                    Modifier.border(
                        width = if (selected) 1.5.dp else 1.dp,
                        color = if (selected) PostalColors.attention else PostalColors.border,
                        shape = shape
                    )
                }
            )
            .clickable(enabled = enabled, onClick = onToggle)
            .padding(16.dp)
            .height(IntrinsicSize.Min),
        verticalAlignment = Alignment.Top
    ) {
        Box(
            modifier = Modifier
                .padding(top = 2.dp)
                .size(20.dp)
                .border(
                    2.dp,
                    if (selected) PostalColors.attention else PostalColors.borderStrong,
                    CircleShape
                ),
            contentAlignment = Alignment.Center
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(PostalColors.attention, CircleShape)
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Box(
            modifier = Modifier
                .width(1.dp)
                .fillMaxHeight()
                .background(PostalColors.border)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column {
            Text(
                text = option.label,
                fontFamily = PostalDisplayFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = PostalColors.text
            )
            option.description?.let { description ->
                Text(
                    text = description,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = PostalColors.muted,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

/** Embossed postal red submit button with a paper-plane wax seal feel. */
@Composable
private fun PostalSubmitButton(
    enabled: Boolean,
    onClick: () -> Unit
) {
    val outerShape = RoundedCornerShape(6.dp)
    Box(
        modifier = Modifier
            .alpha(if (enabled) 1f else 0.5f)
            .shadow(if (enabled) 3.dp else 0.dp, outerShape, ambientColor = PostalColors.shadow, spotColor = PostalColors.shadow)
            .clip(outerShape)
            .background(PostalColors.attention)
            .border(1.dp, PostalColors.attentionForeground, outerShape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(2.dp)
            .border(2.dp, PostalColors.attentionContrast.copy(alpha = 0.25f), RoundedCornerShape(4.dp))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 30.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = PaperPlaneIcon,
                contentDescription = null,
                tint = PostalColors.attentionContrast,
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = "Submit answer".uppercase(),
                fontFamily = PostalDisplayFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                letterSpacing = 0.12.em,
                color = PostalColors.attentionContrast
            )
        }
    }
}

@Composable
private fun SubtleTextButton(
    text: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Text(
        text = text,
        fontSize = 14.sp,
        color = PostalColors.muted,
        modifier = Modifier
            .alpha(if (enabled) 1f else 0.5f)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    )
}

@Composable
private fun HandoffContextSection(question: QuestionDetailUiState) {
    val handoff = question.handoffContext
    val additionalInfo = handoff?.additionalInfo.orEmpty()
    val hasAnyContext = handoff?.problemContext != null ||
        handoff?.codebaseContext != null ||
        additionalInfo.isNotEmpty()

    PostalPanel {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Context".uppercase(),
                style = PostalCaptionStyle
            )
            if (!hasAnyContext) {
                Text(
                    text = "No additional context was provided for this question.",
                    fontSize = 14.sp,
                    color = PostalColors.muted
                )
            } else {
                handoff?.problemContext?.let { LabeledBlock("Problem context", it) }
                handoff?.codebaseContext?.let { LabeledBlock("Codebase context", it) }
                additionalInfo.forEach { item ->
                    LabeledBlock(item.title ?: item.kind, item.content)
                }
            }
        }
    }
}

@Composable
private fun LabeledBlock(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = title,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            color = PostalColors.text
        )
        Text(
            text = body,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            color = PostalColors.subtle
        )
    }
}

@Composable
private fun EmptyQuestionsCard(isSyncing: Boolean = false) {
    PostalPanel {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = if (isSyncing) "Checking for questions…" else "All caught up",
                style = MaterialTheme.typography.titleMedium,
                color = PostalColors.text
            )
            Text(
                text = if (isSyncing) {
                    "Syncing with your Postbox server."
                } else {
                    "When an agent needs a decision, it will appear here."
                },
                fontSize = 14.sp,
                color = PostalColors.subtle
            )
        }
    }
}

private enum class PostalMessageTone { NEUTRAL, DANGER }

@Composable
private fun PostalMessageCard(
    title: String,
    body: String,
    tone: PostalMessageTone = PostalMessageTone.NEUTRAL
) {
    PostalPanel(
        borderColor = if (tone == PostalMessageTone.DANGER) PostalColors.attentionBorder else PostalColors.border,
        backgroundColor = if (tone == PostalMessageTone.DANGER) {
            PostalColors.danger.copy(alpha = 0.08f).compositeOver(PostalColors.elevated)
        } else {
            PostalColors.elevated
        }
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = if (tone == PostalMessageTone.DANGER) PostalColors.dangerForeground else PostalColors.text
            )
            Text(
                text = body,
                fontSize = 14.sp,
                color = PostalColors.subtle
            )
        }
    }
}

/** Elevated paper panel: the shared postal card chrome. */
@Composable
private fun PostalPanel(
    modifier: Modifier = Modifier,
    borderColor: Color = PostalColors.border,
    backgroundColor: Color = PostalColors.elevated,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .shadow(2.dp, shape, ambientColor = PostalColors.shadow, spotColor = PostalColors.shadow)
            .clip(shape)
            .background(backgroundColor)
            .border(1.dp, borderColor, shape),
        content = content
    )
}

/** Delivered: the rubber stamp slams onto the page, settles with a slight rotation. */
@Composable
private fun DeliveredStampOverlay(
    delivering: Boolean,
    onDismiss: () -> Unit
) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 650, easing = CubicBezierEasing(0.3f, 0.8f, 0.4f, 1f))
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PostalColors.canvas.copy(alpha = 0.85f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            val p = progress.value
            Image(
                painter = painterResource(R.drawable.stamp_delivered),
                contentDescription = "Answer delivered",
                modifier = Modifier
                    .fillMaxWidth(0.65f)
                    .widthIn(max = 260.dp)
                    .graphicsLayer {
                        val scale = stampScale(p)
                        scaleX = scale
                        scaleY = scale
                        rotationZ = stampRotation(p)
                        alpha = stampAlpha(p)
                    }
            )
            Text(
                text = if (delivering) "Delivering your answer…" else "Answer delivered",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = PostalColors.subtle
            )
        }
    }
}

// Piecewise keyframes matching the web stamp-down CSS animation.
private fun stampScale(p: Float): Float = when {
    p < 0.6f -> lerp(1.9f, 0.94f, p / 0.6f)
    p < 0.78f -> lerp(0.94f, 1.04f, (p - 0.6f) / 0.18f)
    else -> lerp(1.04f, 1f, (p - 0.78f) / 0.22f)
}

private fun stampRotation(p: Float): Float = if (p < 0.6f) lerp(5f, -12f, p / 0.6f) else -12f

private fun stampAlpha(p: Float): Float = (p / 0.45f).coerceAtMost(1f)

private fun lerp(from: Float, to: Float, fraction: Float): Float = from + (to - from) * fraction

private fun parseInstant(timestamp: String): Instant? =
    runCatching { Instant.parse(timestamp) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(timestamp).toInstant() }.getOrNull()

/** "just now", "5 min ago", "3 h ago", "2 days ago" — question age at a glance. */
internal fun formatTimeAgo(timestamp: String, now: Instant = Instant.now()): String {
    val then = parseInstant(timestamp) ?: return "unknown"
    val seconds = Duration.between(then, now).seconds.coerceAtLeast(0)
    if (seconds < 60) return "just now"
    val minutes = seconds / 60
    if (minutes < 60) return "$minutes min ago"
    val hours = minutes / 60
    if (hours < 24) return "$hours h ago"
    val days = hours / 24
    return if (days == 1L) "1 day ago" else "$days days ago"
}

private fun String.nullIfBlank(): String? = trim().ifBlank { null }

@Preview(showBackground = true)
@Composable
private fun QuestionWorkflowScreenPreview() {
    PostboxTheme {
        QuestionWorkflowScreen(
            state = QuestionWorkflowState(
                baseUrl = "https://postbox.tailnet.example:32187/",
                isLoading = false,
                connectionState = QuestionConnectionState.CONNECTED,
                sessions = listOf(
                    QuestionSessionUiState(
                        sessionId = "session-live",
                        title = "Native Android UI",
                        projectId = "postbox-project",
                        projectName = "Postbox",
                        machineName = "Pixel",
                        semanticState = "blocked",
                        presence = "live",
                        branch = "feature/native-question-ui"
                    )
                ),
                pendingQuestions = listOf(
                    QuestionListItemUiState(
                        requestId = "ask-single",
                        sessionId = "session-live",
                        prompt = "Choose one deployment target",
                        mode = QuestionMode.SINGLE,
                        createdAt = "now",
                        expiresAt = null
                    )
                ),
                visibleQuestion = QuestionDetailUiState(
                    requestId = "ask-single",
                    sessionId = "session-live",
                    mode = QuestionMode.SINGLE,
                    prompt = "Choose one deployment target",
                    questionContext = "The verified server URL belongs to the developer Tailnet.",
                    relevance = "The Android client should guide the developer to a reachable endpoint.",
                    decisionImpact = "The selected target controls which server receives the answer.",
                    options = listOf(
                        QuestionOptionUiState("tailnet", "Use Tailnet HTTPS", "Connect to the verified HTTPS URL."),
                        QuestionOptionUiState("loopback", "Use emulator loopback", "Connect to 10.0.2.2.")
                    ),
                    handoffContext = null,
                    forkReference = null,
                    availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
                )
            ),
            onShowQueue = {},
            onSelectProject = {},
            onSelectSession = {},
            onSelectQuestion = {},
            onToggleOption = {},
            onSubmitAnswer = {},
            onCancelQuestion = {},
            onDismissQuestion = {},
            onEditServerUrl = {}
        )
    }
}

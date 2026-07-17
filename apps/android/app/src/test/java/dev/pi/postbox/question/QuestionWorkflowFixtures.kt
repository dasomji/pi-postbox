package dev.pi.postbox.question

import dev.pi.postbox.protocol.AskMode
import dev.pi.postbox.protocol.AskOption
import dev.pi.postbox.protocol.AskQuestion
import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskResult
import dev.pi.postbox.protocol.AskResultStatus
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.ForkReference
import dev.pi.postbox.protocol.HandoffContext
import dev.pi.postbox.protocol.HealthResponse
import dev.pi.postbox.protocol.PresenceState
import dev.pi.postbox.protocol.ProjectIcon
import dev.pi.postbox.protocol.RichContextItem
import dev.pi.postbox.protocol.SemanticState
import dev.pi.postbox.protocol.SessionSnapshot
import dev.pi.postbox.protocol.StateSnapshot

internal const val VERIFIED_BASE_URL = "https://postbox.tailnet.example:32187/"

internal fun questionWorkflowState(
    requests: List<AskRequestSnapshot> = listOf(singlePendingQuestion(), multiPendingQuestion())
): StateSnapshot = StateSnapshot(
    sessions = listOf(
        sessionSnapshot(
            sessionId = "session-live",
            title = "Native Android UI",
            machineName = "Pixel Fold",
            projectName = "Postbox",
            semanticState = SemanticState.BLOCKED,
            presence = PresenceState.LIVE
        ),
        sessionSnapshot(
            sessionId = "session-offline",
            title = "Protocol maintenance",
            machineName = "Studio Mac",
            projectName = "Pi Dashboard",
            semanticState = SemanticState.IDLE,
            presence = PresenceState.OFFLINE
        )
    ),
    requests = requests,
    timestamp = "2026-06-25T12:00:00.000Z"
)

internal fun singlePendingQuestion(
    requestId: String = "ask-single",
    prompt: String = "Choose one deployment target",
    questionContext: String? = "The verified server URL belongs to the developer Tailnet.",
    status: AskStatus = AskStatus.PENDING,
    result: AskResult? = null,
    resolvedAt: String? = null
): AskRequestSnapshot = AskRequestSnapshot(
    requestId = requestId,
    sessionId = "session-live",
    mode = AskMode.SINGLE,
    question = AskQuestion(
        prompt = prompt,
        context = questionContext,
        relevance = "The Android client should guide the developer to a reachable endpoint.",
        decisionImpact = "The selected target controls which server receives the answer."
    ),
    options = listOf(
        AskOption(value = "tailnet", label = "Use Tailnet HTTPS", description = "Connect to the verified Tailscale HTTPS URL."),
        AskOption(value = "loopback", label = "Use emulator loopback", description = "Connect to 10.0.2.2 for local emulator testing.")
    ),
    context = HandoffContext(
        codebaseContext = "Android app lives under apps/android and uses the Postbox HTTP protocol.",
        problemContext = "A native user must be able to inspect enough context before answering.",
        additionalInfo = listOf(
            RichContextItem(
                kind = "markdown",
                title = "Server contract",
                content = "POST /api/requests/:requestId/answer accepts selectedValues.",
                language = "md"
            )
        )
    ),
    forkReference = ForkReference(
        agentSessionId = "native-ui-session",
        agentSessionPath = "/tmp/native-ui-session.jsonl",
        leafId = "leaf-unit-04",
        cwd = "/workspaces/postbox",
        model = "test-model"
    ),
    status = status,
    createdAt = "2026-06-25T11:59:00.000Z",
    expiresAt = "2026-06-25T12:30:00.000Z",
    resolvedAt = resolvedAt,
    result = result
)

internal fun multiPendingQuestion(
    requestId: String = "ask-multi",
    status: AskStatus = AskStatus.PENDING,
    result: AskResult? = null,
    resolvedAt: String? = null
): AskRequestSnapshot = AskRequestSnapshot(
    requestId = requestId,
    sessionId = "session-live",
    mode = AskMode.MULTI,
    question = AskQuestion(
        prompt = "Pick all UI states to expose",
        context = "The prototype should still be useful when the stream disconnects.",
        relevance = "Multi-select questions are common during review fanout.",
        decisionImpact = "Missing states make the native app less capable than the web dashboard."
    ),
    options = listOf(
        AskOption(value = "loading", label = "Loading", description = "Show initial fetch progress."),
        AskOption(value = "empty", label = "Empty", description = "Show when there are no pending questions."),
        AskOption(value = "disconnected", label = "Disconnected", description = "Keep the visible question on screen.")
    ),
    context = HandoffContext(
        codebaseContext = "Android question workflow with multi-select answer support.",
        problemContext = "Several answers can be true at once."
    ),
    status = status,
    createdAt = "2026-06-25T12:01:00.000Z",
    expiresAt = "2026-06-25T12:45:00.000Z",
    resolvedAt = resolvedAt,
    result = result
)

internal fun answeredSingleQuestion(): AskRequestSnapshot = singlePendingQuestion(
    status = AskStatus.ANSWERED,
    resolvedAt = "2026-06-25T12:02:00.000Z",
    result = AskResult(
        status = AskResultStatus.ANSWERED,
        requestId = "ask-single",
        selectedValues = listOf("loopback"),
        note = "Use emulator for this prototype.",
        resolvedAt = "2026-06-25T12:02:00.000Z"
    )
)

internal fun cancelledMultiQuestion(): AskRequestSnapshot = multiPendingQuestion(
    status = AskStatus.CANCELLED,
    resolvedAt = "2026-06-25T12:03:00.000Z",
    result = AskResult(
        status = AskResultStatus.CANCELLED,
        requestId = "ask-multi",
        note = "No longer needed.",
        resolvedAt = "2026-06-25T12:03:00.000Z"
    )
)

internal fun longContextQuestion(
    longPrompt: String,
    longQuestionContext: String,
    longProblemContext: String,
    longRichContext: String
): AskRequestSnapshot = singlePendingQuestion(
    requestId = "ask-long",
    prompt = longPrompt,
    questionContext = longQuestionContext
).copy(
    context = HandoffContext(
        codebaseContext = "Compose screens should receive complete text and decide scrolling in the UI layer.",
        problemContext = longProblemContext,
        additionalInfo = listOf(
            RichContextItem(
                kind = "log",
                title = "Full terminal transcript",
                content = longRichContext,
                language = "text"
            )
        )
    )
)

private fun sessionSnapshot(
    sessionId: String,
    title: String,
    machineName: String,
    projectName: String,
    semanticState: SemanticState,
    presence: PresenceState
): SessionSnapshot = SessionSnapshot(
    sessionId = sessionId,
    title = title,
    machineId = "$sessionId-machine",
    machineName = machineName,
    hostname = "$sessionId.local",
    projectId = "$sessionId-project",
    projectName = projectName,
    projectDetectedName = projectName.lowercase().replace(" ", "-"),
    projectDescription = "Project shown in the native question list.",
    projectIcon = ProjectIcon(
        hash = "sha256:$sessionId",
        dataUrl = "data:image/svg+xml;base64,PHN2Zy8+",
        mediaType = "image/svg+xml",
        sizeBytes = 6
    ),
    cwd = "/workspaces/$sessionId",
    gitRoot = "/workspaces/$sessionId",
    repoName = projectName.lowercase().replace(" ", "-"),
    branch = "feature/native-question-ui",
    headSha = "abc123$sessionId",
    isDirty = true,
    worktreePath = "/worktrees/$sessionId",
    semanticState = semanticState,
    presence = presence,
    lastHeartbeatAt = "2026-06-25T11:58:00.000Z",
    connectedAt = "2026-06-25T11:30:00.000Z",
    disconnectedAt = if (presence == PresenceState.OFFLINE) "2026-06-25T11:55:00.000Z" else null,
    updatedAt = "2026-06-25T12:00:00.000Z"
)

internal fun healthResponse(): HealthResponse = HealthResponse(
    ok = true,
    service = "pi-postbox",
    version = "0.1.0",
    protocolVersion = "1"
)

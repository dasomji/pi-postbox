package dev.pi.postbox.question

import dev.pi.postbox.protocol.GeneratedPostboxProtocolContract

import dev.pi.postbox.protocol.AskMode
import dev.pi.postbox.protocol.AskOption
import dev.pi.postbox.protocol.AskQuestion
import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskResult
import dev.pi.postbox.protocol.AskResultStatus
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.ForkReference
import dev.pi.postbox.protocol.HealthResponse
import dev.pi.postbox.protocol.PresenceState
import dev.pi.postbox.protocol.ProjectIcon
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
    ambiguity: String? = "Which reachable endpoint should receive the answer?",
    status: AskStatus = AskStatus.PENDING,
    result: AskResult? = null,
    resolvedAt: String? = null
): AskRequestSnapshot = AskRequestSnapshot(
    requestId = requestId,
    sessionId = "session-live",
    mode = AskMode.SINGLE,
    question = AskQuestion(
        prompt = prompt,
        ambiguity = ambiguity
    ),
    options = listOf(
        AskOption(value = "tailnet", label = "Use Tailnet HTTPS", description = "Connect to the verified Tailscale HTTPS URL."),
        AskOption(value = "loopback", label = "Use emulator loopback", description = "Connect to 10.0.2.2 for local emulator testing.")
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
        ambiguity = "Which disconnected and multi-select states must the native app expose?"
    ),
    options = listOf(
        AskOption(value = "loading", label = "Loading", description = "Show initial fetch progress."),
        AskOption(value = "empty", label = "Empty", description = "Show when there are no pending questions."),
        AskOption(value = "disconnected", label = "Disconnected", description = "Keep the visible question on screen.")
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

internal fun longQuestion(
    longPrompt: String,
    longAmbiguity: String
): AskRequestSnapshot = singlePendingQuestion(
    requestId = "ask-long",
    prompt = longPrompt,
    ambiguity = longAmbiguity
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
    buildId = "0.1.0",
    protocolVersion = GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION,
    profile = dev.pi.postbox.protocol.ServerProfileIdentity(kind = "production", id = "production")
)

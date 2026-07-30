package dev.pi.postbox.questionchat

import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private val questionChatStarterPrompts = mapOf(
    QuestionChatStarter.ELABORATE to "Explain the asking agent's language and intent in this question.",
    QuestionChatStarter.PRO_CONS to "Compare the relevant trade-offs of this decision at my current level.",
    QuestionChatStarter.TEACH_ME to "Teach me the minimum foundational concepts I need to understand this question."
)

data class QuestionChatBindingKey(
    val normalizedServerUrl: String,
    val requestId: String
)

enum class QuestionChatStarter {
    ELABORATE,
    PRO_CONS,
    TEACH_ME
}

sealed interface QuestionChatIntent {
    data class SetForeground(val foreground: Boolean) : QuestionChatIntent
    data object ActivateExact : QuestionChatIntent
    data object ActivateContextFallback : QuestionChatIntent
    data object Retry : QuestionChatIntent
    data class DraftChanged(val text: String) : QuestionChatIntent
    data object SendDraft : QuestionChatIntent
    data class SendStarter(val starter: QuestionChatStarter) : QuestionChatIntent
    data object Stop : QuestionChatIntent
    data object QuestionBecameTerminal : QuestionChatIntent
}

enum class QuestionChatConnectionState {
    SYNCHRONIZING,
    ONLINE,
    OFFLINE,
    TERMINAL
}

sealed interface QuestionChatActivationUiState {
    data object Idle : QuestionChatActivationUiState
    data object Probing : QuestionChatActivationUiState
    data object ActivatingExact : QuestionChatActivationUiState
    data object ActivatingContextFallback : QuestionChatActivationUiState
    data class AwaitingContextFallbackConfirmation(val error: QuestionChatAvailabilityError) : QuestionChatActivationUiState
    data class Unavailable(val error: QuestionChatAvailabilityError) : QuestionChatActivationUiState
}

data class QuestionChatSessionUiState(
    val snapshot: QuestionChatSnapshot,
    val connection: QuestionChatConnectionState
)

data class QuestionChatPendingSend(
    val clientCommandId: String,
    val message: String
)

data class QuestionChatRenderedAssistantMessage(
    val sourceText: String,
    val rendered: SafeMarkdownRenderResult
)

data class QuestionChatOwnerState(
    val key: QuestionChatBindingKey? = null,
    val isForeground: Boolean = false,
    val knownStarted: Boolean = false,
    val activation: QuestionChatActivationUiState = QuestionChatActivationUiState.Idle,
    val session: QuestionChatSessionUiState? = null,
    val draftText: String = "",
    val pendingSend: QuestionChatPendingSend? = null,
    val pendingStopCommandId: String? = null,
    val actionMessage: String? = null,
    val composerFocusToken: Long = 0L,
    val renderedAssistantMessages: Map<String, QuestionChatRenderedAssistantMessage> = emptyMap()
)

class QuestionChatOwner(
    private val httpClient: QuestionChatHttpClient,
    private val eventTransport: QuestionChatEventTransport,
    private val scope: CoroutineScope,
    private val markdownParser: SafeMarkdownParser = SafeMarkdownParser()
) : Closeable {
    private val commandCounter = AtomicLong(0)
    private val mutableState = MutableStateFlow(QuestionChatOwnerState())
    private val mutableIdle = MutableStateFlow(true)
    private val activeJobs = linkedSetOf<Job>()
    private var generation = 0L
    private var eventConnection: QuestionChatEventConnection? = null

    val state: StateFlow<QuestionChatOwnerState> = mutableState.asStateFlow()
    val idle: StateFlow<Boolean> = mutableIdle.asStateFlow()

    fun bind(key: QuestionChatBindingKey?) {
        if (mutableState.value.key == key) return
        generation += 1
        cancelActiveWork()
        mutableState.value = QuestionChatOwnerState(
            key = key,
            isForeground = mutableState.value.isForeground
        )
        if (key != null && mutableState.value.isForeground) {
            startProbe(key, generation)
        }
    }

    fun dispatch(intent: QuestionChatIntent) {
        when (intent) {
            is QuestionChatIntent.SetForeground -> {
                mutableState.value = mutableState.value.copy(isForeground = intent.foreground)
                val key = mutableState.value.key
                if (intent.foreground && key != null) {
                    if (mutableState.value.knownStarted) {
                        startSynchronize(key, generation)
                    } else if (mutableState.value.activation == QuestionChatActivationUiState.Idle) {
                        startProbe(key, generation)
                    }
                }
                if (!intent.foreground && mutableState.value.session != null) {
                    eventConnection?.close()
                    eventConnection = null
                    mutableState.value = mutableState.value.copy(
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
            QuestionChatIntent.ActivateExact -> mutableState.value.key?.let { startExactActivation(it, generation) }
            QuestionChatIntent.ActivateContextFallback -> mutableState.value.key?.let { startContextActivation(it, generation) }
            QuestionChatIntent.Retry -> mutableState.value.key?.let { key ->
                if (mutableState.value.knownStarted) startSynchronize(key, generation) else startProbe(key, generation)
            }
            is QuestionChatIntent.DraftChanged -> mutableState.value = mutableState.value.copy(draftText = intent.text.take(8_000))
            QuestionChatIntent.SendDraft -> mutableState.value.key?.let { key -> startSend(key, generation, mutableState.value.draftText.trim()) }
            is QuestionChatIntent.SendStarter -> mutableState.value.key?.let { key -> startSend(key, generation, questionChatStarterPrompts.getValue(intent.starter)) }
            QuestionChatIntent.Stop -> mutableState.value.key?.let { key -> startStop(key, generation) }
            QuestionChatIntent.QuestionBecameTerminal -> {
                eventConnection?.close()
                eventConnection = null
                mutableState.value = mutableState.value.copy(
                    session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.TERMINAL)
                )
            }
        }
    }

    override fun close() {
        generation += 1
        cancelActiveWork()
        mutableState.value = QuestionChatOwnerState()
    }

    private fun startProbe(key: QuestionChatBindingKey, expectedGeneration: Long) {
        mutableState.value = mutableState.value.copy(
            activation = QuestionChatActivationUiState.Probing,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val result = httpClient.probeSnapshot(key.requestId)) {
                    is QuestionChatProbeResult.NotStarted -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = false,
                            activation = QuestionChatActivationUiState.Idle,
                            session = null
                        )
                    }
                    is QuestionChatProbeResult.Unavailable -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = false,
                            activation = QuestionChatActivationUiState.Unavailable(result.error),
                            session = null
                        )
                    }
                    is QuestionChatProbeResult.Ready -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = true,
                            activation = QuestionChatActivationUiState.Idle,
                            session = QuestionChatSessionUiState(result.snapshot, QuestionChatConnectionState.SYNCHRONIZING)
                        )
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, result.snapshot)
                        scheduleSynchronize(key, expectedGeneration)
                    }
                }
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error))
                    )
                }
            }
        }
    }

    private fun startExactActivation(key: QuestionChatBindingKey, expectedGeneration: Long) {
        mutableState.value = mutableState.value.copy(
            activation = QuestionChatActivationUiState.ActivatingExact,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val result = httpClient.activateExact(key.requestId)) {
                    is QuestionChatActivationResult.Ready -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = true,
                            activation = QuestionChatActivationUiState.Idle,
                            session = QuestionChatSessionUiState(result.snapshot, QuestionChatConnectionState.SYNCHRONIZING)
                        )
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, result.snapshot)
                        scheduleSynchronize(key, expectedGeneration)
                    }
                    is QuestionChatActivationResult.Unavailable -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            activation = if (
                                (result.error.code == QuestionChatAvailabilityCode.SOURCE_PATH_MISSING ||
                                    result.error.code == QuestionChatAvailabilityCode.SOURCE_LEAF_MISSING) &&
                                    result.error.contextFallback == QuestionChatContextFallbackAvailability.Available
                            ) {
                                QuestionChatActivationUiState.AwaitingContextFallbackConfirmation(result.error)
                            } else {
                                QuestionChatActivationUiState.Unavailable(result.error)
                            }
                        )
                    }
                }
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error))
                    )
                }
            }
        }
    }

    private fun startContextActivation(key: QuestionChatBindingKey, expectedGeneration: Long) {
        mutableState.value = mutableState.value.copy(
            activation = QuestionChatActivationUiState.ActivatingContextFallback,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val result = httpClient.activateContext(key.requestId)) {
                    is QuestionChatActivationResult.Ready -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = true,
                            activation = QuestionChatActivationUiState.Idle,
                            session = QuestionChatSessionUiState(result.snapshot, QuestionChatConnectionState.SYNCHRONIZING)
                        )
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, result.snapshot)
                        scheduleSynchronize(key, expectedGeneration)
                    }
                    is QuestionChatActivationResult.Unavailable -> ifCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            activation = QuestionChatActivationUiState.Unavailable(result.error)
                        )
                    }
                }
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error))
                    )
                }
            }
        }
    }

    private fun scheduleSynchronize(key: QuestionChatBindingKey, expectedGeneration: Long) {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            startSynchronize(key, expectedGeneration)
        }
    }

    private fun startSynchronize(key: QuestionChatBindingKey, expectedGeneration: Long) {
        if (!mutableState.value.isForeground) return
        eventConnection?.close()
        eventConnection = null
        mutableState.value = mutableState.value.copy(
            knownStarted = true,
            activation = QuestionChatActivationUiState.Idle,
            session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
        )
        val buffered = mutableListOf<QuestionChatStreamEvent>()
        val connection = eventTransport.open(key.requestId) { fact ->
            when (fact) {
                QuestionChatEventTransportFact.Open -> Unit
                QuestionChatEventTransportFact.EndOfStream,
                is QuestionChatEventTransportFact.Failure -> ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
                is QuestionChatEventTransportFact.Event -> ifCurrent(key, expectedGeneration) {
                    if (mutableState.value.session?.connection == QuestionChatConnectionState.SYNCHRONIZING) {
                        buffered += fact.event
                    } else {
                        applyLiveEvent(fact.event)
                    }
                }
            }
        }
        eventConnection = connection
        launchTracked {
            try {
                connection.ready.await()
                if (!isCurrent(key, expectedGeneration)) return@launchTracked
                val snapshot = httpClient.fetchSnapshot(key.requestId)
                if (!isCurrent(key, expectedGeneration)) return@launchTracked
                val synchronizedSnapshot = applyBufferedSnapshot(snapshot, buffered)
                mutableState.value = mutableState.value.copy(
                    session = QuestionChatSessionUiState(
                        synchronizedSnapshot,
                        QuestionChatConnectionState.ONLINE
                    )
                )
                scheduleRenderedAssistantMessageParses(key, expectedGeneration, synchronizedSnapshot)
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error)),
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
        }
    }

    private fun startSend(key: QuestionChatBindingKey, expectedGeneration: Long, message: String) {
        val current = mutableState.value
        val session = current.session ?: return
        if (message.isBlank() || session.connection != QuestionChatConnectionState.ONLINE || current.pendingSend != null) return
        val commandId = "android-chat-${commandCounter.incrementAndGet()}"
        mutableState.value = current.copy(
            pendingSend = QuestionChatPendingSend(commandId, message),
            actionMessage = null
        )
        launchTracked {
            try {
                val response = httpClient.sendMessage(key.requestId, commandId, message)
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        draftText = "",
                        pendingSend = null,
                        actionMessage = when (response.mode) {
                            QuestionChatSendMode.STEER -> "Steering the current answer."
                            else -> "Question Chat is answering."
                        },
                        composerFocusToken = mutableState.value.composerFocusToken + 1
                    )
                }
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        pendingSend = null,
                        actionMessage = error.message ?: "Unable to send message."
                    )
                }
            }
        }
    }

    private fun startStop(key: QuestionChatBindingKey, expectedGeneration: Long) {
        val current = mutableState.value
        val session = current.session ?: return
        if (
            session.connection != QuestionChatConnectionState.ONLINE ||
                current.pendingStopCommandId != null ||
                session.snapshot.state != QuestionChatState.GENERATING
        ) return
        val commandId = "android-stop-${commandCounter.incrementAndGet()}"
        mutableState.value = current.copy(
            pendingStopCommandId = commandId,
            actionMessage = null
        )
        launchTracked {
            try {
                httpClient.stop(key.requestId, commandId)
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        pendingStopCommandId = null,
                        actionMessage = "Stopping Question Chat…"
                    )
                }
            } catch (error: Exception) {
                ifCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        pendingStopCommandId = null,
                        actionMessage = error.message ?: "Unable to stop Question Chat."
                    )
                }
            }
        }
    }

    private fun applyLiveEvent(event: QuestionChatStreamEvent) {
        val session = mutableState.value.session ?: return
        when (event) {
            is QuestionChatStreamEvent.Transport -> {
                mutableState.value = mutableState.value.copy(
                    session = session.copy(connection = if (event.online) QuestionChatConnectionState.ONLINE else QuestionChatConnectionState.OFFLINE)
                )
            }
            is QuestionChatStreamEvent.Event -> {
                if (event.payload.sequence > session.snapshot.sequence + 1) {
                    mutableState.value = mutableState.value.copy(
                        session = session.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
                    )
                    mutableState.value.key?.let { key -> startSynchronize(key, generation) }
                    return
                }
                val updatedSnapshot = applyQuestionChatEvent(session.snapshot, event.payload)
                mutableState.value = mutableState.value.copy(
                    session = session.copy(snapshot = updatedSnapshot)
                )
                mutableState.value.key?.let { key ->
                    scheduleRenderedAssistantMessageParses(key, generation, updatedSnapshot)
                }
            }
        }
    }

    private fun applyBufferedSnapshot(
        snapshot: QuestionChatSnapshot,
        buffered: List<QuestionChatStreamEvent>
    ): QuestionChatSnapshot {
        var current = snapshot
        buffered.sortedBy { sequenceOf(it) }.forEach { event ->
            if (event is QuestionChatStreamEvent.Event) {
                current = applyQuestionChatEvent(current, event.payload)
            }
        }
        return current
    }

    private fun scheduleRenderedAssistantMessageParses(
        key: QuestionChatBindingKey,
        expectedGeneration: Long,
        snapshot: QuestionChatSnapshot
    ) {
        val terminalAssistantMessages = snapshot.messages
            .filterIsInstance<QuestionChatMessage.Assistant>()
            .filter { it.status != QuestionChatMessage.Assistant.Status.STREAMING }
        val retainIds = terminalAssistantMessages.mapTo(linkedSetOf()) { it.id }
        mutableState.value = mutableState.value.copy(
            renderedAssistantMessages = mutableState.value.renderedAssistantMessages.filterKeys { it in retainIds }
        )
        terminalAssistantMessages.forEach { message ->
            val existing = mutableState.value.renderedAssistantMessages[message.id]
            if (existing?.sourceText == message.text) return@forEach
            launchTracked {
                val rendered = markdownParser.parse(message.text)
                ifCurrent(key, expectedGeneration) {
                    val currentMessage = mutableState.value.session?.snapshot?.messages
                        ?.filterIsInstance<QuestionChatMessage.Assistant>()
                        ?.firstOrNull { it.id == message.id }
                    if (currentMessage != null && currentMessage.status != QuestionChatMessage.Assistant.Status.STREAMING && currentMessage.text == message.text) {
                        mutableState.value = mutableState.value.copy(
                            renderedAssistantMessages = mutableState.value.renderedAssistantMessages + (
                                message.id to QuestionChatRenderedAssistantMessage(
                                    sourceText = message.text,
                                    rendered = rendered
                                )
                            )
                        )
                    }
                }
            }
        }
    }

    private fun runtimeFailure(error: Exception) = QuestionChatAvailabilityError(
        QuestionChatAvailabilityCode.RUNTIME_FAILURE,
        error.message ?: "Question Chat unavailable."
    )

    private inline fun ifCurrent(key: QuestionChatBindingKey, expectedGeneration: Long, block: () -> Unit) {
        if (isCurrent(key, expectedGeneration)) {
            block()
        }
    }

    private fun isCurrent(key: QuestionChatBindingKey, expectedGeneration: Long): Boolean =
        mutableState.value.key == key && generation == expectedGeneration

    private fun launchTracked(block: suspend () -> Unit) {
        mutableIdle.value = false
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                block()
            } finally {
                activeJobs.remove(this.coroutineContext[Job])
                mutableIdle.value = activeJobs.isEmpty()
            }
        }
        activeJobs += job
    }

    private fun cancelActiveWork() {
        activeJobs.forEach { it.cancel() }
        activeJobs.clear()
        eventConnection?.close()
        eventConnection = null
        mutableIdle.value = true
    }
}

private const val QUESTION_CHAT_MESSAGE_MAX = 100
private const val QUESTION_CHAT_ASSISTANT_TEXT_MAX = 32_000
private const val QUESTION_CHAT_TOOL_ACTIVITY_MAX = 50

internal fun applyQuestionChatEvent(snapshot: QuestionChatSnapshot, event: QuestionChatEvent): QuestionChatSnapshot {
    if (snapshot.requestId != event.requestId || event.sequence <= snapshot.sequence) return snapshot
    if (event.sequence > snapshot.sequence + 1) return snapshot
    val messages = snapshot.messages.toMutableList()
    val tools = snapshot.tools.toMutableList()
    when (event) {
        is QuestionChatEvent.Lifecycle -> {
            return snapshot.copy(state = event.state, sequence = event.sequence)
        }
        is QuestionChatEvent.MessageStarted -> {
            val existing = messages.indexOfFirst { it.id == event.message.id }
            if (existing >= 0) messages[existing] = event.message else messages += event.message
        }
        is QuestionChatEvent.AssistantTextDelta -> {
            val existing = messages.indexOfFirst { it.id == event.messageId && it is QuestionChatMessage.Assistant }
            if (existing >= 0) {
                val assistant = messages[existing] as QuestionChatMessage.Assistant
                messages[existing] = assistant.copy(
                    text = (assistant.text + event.text).take(QUESTION_CHAT_ASSISTANT_TEXT_MAX),
                    status = QuestionChatMessage.Assistant.Status.STREAMING
                )
            }
        }
        is QuestionChatEvent.MessageFinished -> {
            val existing = messages.indexOfFirst { it.id == event.messageId && it is QuestionChatMessage.Assistant }
            if (existing >= 0) {
                val assistant = messages[existing] as QuestionChatMessage.Assistant
                messages[existing] = assistant.copy(
                    text = event.text.take(QUESTION_CHAT_ASSISTANT_TEXT_MAX),
                    status = event.status
                )
            }
        }
        is QuestionChatEvent.ToolStarted -> {
            val existing = tools.indexOfFirst { it.id == event.activity.id }
            if (existing >= 0) tools[existing] = event.activity else tools += event.activity
        }
        is QuestionChatEvent.ToolFinished -> {
            val existing = tools.indexOfFirst { it.id == event.activity.id }
            if (existing >= 0) tools[existing] = event.activity else tools += event.activity
        }
    }
    return snapshot.copy(
        messages = messages.takeLast(QUESTION_CHAT_MESSAGE_MAX),
        tools = tools.takeLast(QUESTION_CHAT_TOOL_ACTIVITY_MAX),
        sequence = event.sequence
    )
}

private fun sequenceOf(event: QuestionChatStreamEvent): Int = when (event) {
    is QuestionChatStreamEvent.Transport -> Int.MIN_VALUE
    is QuestionChatStreamEvent.Event -> event.payload.sequence
}

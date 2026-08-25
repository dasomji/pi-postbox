package dev.pi.postbox.questionchat

import dev.pi.postbox.protocol.PostboxProtocolMismatchException
import dev.pi.postbox.protocol.ProtocolMismatch
import java.io.Closeable
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val questionChatStarterPrompts = mapOf(
    QuestionChatStarter.ELABORATE to "Explain the asking agent's language and intent in this question.",
    QuestionChatStarter.PRO_CONS to "Compare the relevant trade-offs of this decision at my current level.",
    QuestionChatStarter.TEACH_ME to "Teach me the minimum foundational concepts I need to understand this question."
)

private val defaultQuestionChatMarkdownParserDispatcher: CoroutineDispatcher =
    Dispatchers.Default.limitedParallelism(1)

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
    val actionUnavailable: QuestionChatAvailabilityError? = null,
    val actionMessage: String? = null,
    val composerFocusToken: Long = 0L,
    val renderedAssistantMessages: Map<String, QuestionChatRenderedAssistantMessage> = emptyMap()
)

open class QuestionChatOwner(
    private val httpClient: QuestionChatHttpClient,
    private val eventTransport: QuestionChatEventTransport,
    private val scope: CoroutineScope,
    private val onProtocolMismatch: (ProtocolMismatch) -> Unit = {},
    private val markdownParser: SafeMarkdownParser = SafeMarkdownParser(),
    private val markdownParserDispatcher: CoroutineDispatcher = defaultQuestionChatMarkdownParserDispatcher
) : Closeable {
    private val commandCounter = AtomicLong(0)
    private val mutableState = MutableStateFlow(QuestionChatOwnerState())
    private val mutableIdle = MutableStateFlow(true)
    private val activeJobs = linkedSetOf<Job>()
    private val reducerLock = ReentrantLock()
    private var generation = 0L
    private var synchronizeAttempt = 0L
    private var synchronizeJob: Job? = null
    private var eventConnection: QuestionChatEventConnection? = null

    val state: StateFlow<QuestionChatOwnerState> = mutableState.asStateFlow()
    val idle: StateFlow<Boolean> = mutableIdle.asStateFlow()

    open fun bind(key: QuestionChatBindingKey?) = reduce {
        if (mutableState.value.key == key) return@reduce
        val isForeground = mutableState.value.isForeground
        generation += 1
        cancelActiveWork()
        mutableState.value = QuestionChatOwnerState(
            key = key,
            isForeground = isForeground
        )
        if (key != null && isForeground) {
            startProbe(key, generation)
        }
    }

    open fun dispatch(intent: QuestionChatIntent) = reduce {
        when (intent) {
            is QuestionChatIntent.SetForeground -> {
                val current = mutableState.value
                mutableState.value = current.copy(isForeground = intent.foreground)
                val key = current.key ?: return@reduce
                if (intent.foreground) {
                    if (mutableState.value.knownStarted) {
                        startSynchronize(key, generation)
                    } else if (mutableState.value.activation == QuestionChatActivationUiState.Idle) {
                        startProbe(key, generation)
                    }
                } else {
                    generation += 1
                    cancelActiveWork()
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Idle,
                        pendingSend = null,
                        pendingStopCommandId = null,
                        actionUnavailable = null,
                        actionMessage = null,
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
            QuestionChatIntent.ActivateExact -> mutableState.value.key?.let { startExactActivation(it, generation) }
            QuestionChatIntent.Retry -> mutableState.value.key?.let { key ->
                if (mutableState.value.knownStarted) startSynchronize(key, generation) else startProbe(key, generation)
            }
            is QuestionChatIntent.DraftChanged -> mutableState.value = mutableState.value.copy(
                draftText = intent.text.take(8_000),
                actionUnavailable = null
            )
            QuestionChatIntent.SendDraft -> mutableState.value.key?.let { key -> startSend(key, generation, mutableState.value.draftText.trim()) }
            is QuestionChatIntent.SendStarter -> mutableState.value.key?.let { key -> startSend(key, generation, questionChatStarterPrompts.getValue(intent.starter)) }
            QuestionChatIntent.Stop -> mutableState.value.key?.let { key -> startStop(key, generation) }
            QuestionChatIntent.QuestionBecameTerminal -> {
                generation += 1
                cancelActiveWork()
                mutableState.value = mutableState.value.copy(
                    pendingSend = null,
                    pendingStopCommandId = null,
                    actionUnavailable = null,
                    session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.TERMINAL)
                )
            }
        }
    }

    override open fun close() = reduce {
        generation += 1
        cancelActiveWork()
        mutableState.value = QuestionChatOwnerState()
    }

    private fun startProbe(key: QuestionChatBindingKey, expectedGeneration: Long) {
        mutableState.value = mutableState.value.copy(
            activation = QuestionChatActivationUiState.Probing,
            actionUnavailable = null,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val result = httpClient.probeSnapshot(key.requestId)) {
                    is QuestionChatProbeResult.NotStarted -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = false,
                            activation = QuestionChatActivationUiState.Idle,
                            session = null
                        )
                    }
                    is QuestionChatProbeResult.Unavailable -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = false,
                            activation = QuestionChatActivationUiState.Unavailable(result.error),
                            session = null
                        )
                    }
                    is QuestionChatProbeResult.Ready -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = true,
                            activation = QuestionChatActivationUiState.Idle,
                            session = QuestionChatSessionUiState(result.snapshot, QuestionChatConnectionState.SYNCHRONIZING)
                        )
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, result.snapshot)
                        scheduleSynchronize(key, expectedGeneration)
                    }
                }
            } catch (_: CancellationException) {
                return@launchTracked
            } catch (error: Exception) {
                (error as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                reduceIfCurrent(key, expectedGeneration) {
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
            actionUnavailable = null,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val result = httpClient.activateExact(key.requestId)) {
                    is QuestionChatActivationResult.Ready -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            knownStarted = true,
                            activation = QuestionChatActivationUiState.Idle,
                            session = QuestionChatSessionUiState(result.snapshot, QuestionChatConnectionState.SYNCHRONIZING)
                        )
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, result.snapshot)
                        scheduleSynchronize(key, expectedGeneration)
                    }
                    is QuestionChatActivationResult.Unavailable -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            activation = QuestionChatActivationUiState.Unavailable(result.error)
                        )
                    }
                }
            } catch (_: CancellationException) {
                return@launchTracked
            } catch (error: Exception) {
                (error as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                reduceIfCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error))
                    )
                }
            }
        }
    }

    private fun scheduleSynchronize(key: QuestionChatBindingKey, expectedGeneration: Long) = reduce {
        if (isCurrent(key, expectedGeneration)) {
            startSynchronize(key, expectedGeneration)
        }
    }

    private fun startSynchronize(key: QuestionChatBindingKey, expectedGeneration: Long) {
        if (!mutableState.value.isForeground) return
        synchronizeJob?.cancel()
        synchronizeJob = null
        eventConnection?.close()
        eventConnection = null
        synchronizeAttempt += 1
        val attemptId = synchronizeAttempt
        mutableState.value = mutableState.value.copy(
            knownStarted = true,
            activation = QuestionChatActivationUiState.Idle,
            actionUnavailable = null,
            session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
        )
        val buffered = BufferedSynchronization()
        val connection = eventTransport.open(key.requestId) { fact ->
            reduce {
                handleTransportFact(key, expectedGeneration, attemptId, buffered, fact)
            }
        }
        eventConnection = connection
        synchronizeJob = launchTracked {
            try {
                connection.ready.await()
                if (!isCurrentSynchronizeAttempt(key, expectedGeneration, attemptId)) return@launchTracked
                when (val result = httpClient.fetchSnapshot(key.requestId)) {
                    is QuestionChatSnapshotResult.Unavailable -> reduceIfCurrentSynchronizeAttempt(key, expectedGeneration, attemptId) {
                        handleSnapshotUnavailable(result.error)
                    }
                    is QuestionChatSnapshotResult.Ready -> reduceIfCurrentSynchronizeAttempt(key, expectedGeneration, attemptId) {
                        val applied = applyBufferedSnapshot(result.snapshot, buffered.events)
                        val synchronizedSession = QuestionChatSessionUiState(
                            snapshot = applied.snapshot,
                            connection = when {
                                buffered.requiresResync || applied.requiresResync -> QuestionChatConnectionState.SYNCHRONIZING
                                buffered.streamEnded || buffered.streamFailure != null -> QuestionChatConnectionState.OFFLINE
                                applied.connection == QuestionChatConnectionState.OFFLINE -> QuestionChatConnectionState.OFFLINE
                                else -> QuestionChatConnectionState.ONLINE
                            }
                        )
                        mutableState.value = mutableState.value.copy(session = synchronizedSession)
                        scheduleRenderedAssistantMessageParses(key, expectedGeneration, applied.snapshot)
                        if (buffered.requiresResync || applied.requiresResync) {
                            scheduleSynchronize(key, expectedGeneration)
                        }
                    }
                }
            } catch (_: CancellationException) {
                return@launchTracked
            } catch (error: Exception) {
                (error as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                reduceIfCurrentSynchronizeAttempt(key, expectedGeneration, attemptId) {
                    mutableState.value = mutableState.value.copy(
                        activation = QuestionChatActivationUiState.Unavailable(runtimeFailure(error)),
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
        }
    }

    private fun handleTransportFact(
        key: QuestionChatBindingKey,
        expectedGeneration: Long,
        attemptId: Long,
        buffered: BufferedSynchronization,
        fact: QuestionChatEventTransportFact
    ) {
        if (!isCurrentSynchronizeAttempt(key, expectedGeneration, attemptId)) return
        val buffering = mutableState.value.session?.connection == QuestionChatConnectionState.SYNCHRONIZING
        when (fact) {
            QuestionChatEventTransportFact.Open -> Unit
            QuestionChatEventTransportFact.EndOfStream -> {
                if (buffering) {
                    buffered.streamEnded = true
                } else {
                    mutableState.value = mutableState.value.copy(
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
            is QuestionChatEventTransportFact.Failure -> {
                (fact.throwable as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                if (buffering) {
                    buffered.streamFailure = fact.throwable
                } else {
                    mutableState.value = mutableState.value.copy(
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                }
            }
            is QuestionChatEventTransportFact.Stale -> {
                if (buffering) {
                    buffered.requiresResync = true
                } else {
                    mutableState.value = mutableState.value.copy(
                        session = mutableState.value.session?.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
                    )
                    scheduleSynchronize(key, expectedGeneration)
                }
            }
            is QuestionChatEventTransportFact.IncompatibleProtocol -> {
                onProtocolMismatch(fact.mismatch)
                eventConnection?.close()
                eventConnection = null
                mutableState.value = QuestionChatOwnerState(key = key, isForeground = mutableState.value.isForeground)
            }
            is QuestionChatEventTransportFact.Event -> {
                if (buffering) {
                    buffered.events += fact.event
                } else {
                    applyLiveEvent(key, expectedGeneration, fact.event)
                }
            }
        }
    }

    private fun handleSnapshotUnavailable(error: QuestionChatAvailabilityError) {
        eventConnection?.close()
        eventConnection = null
        mutableState.value = mutableState.value.copy(
            activation = QuestionChatActivationUiState.Unavailable(error),
            session = mutableState.value.session?.copy(
                connection = when (error.code) {
                    QuestionChatAvailabilityCode.REQUEST_NOT_PENDING,
                    QuestionChatAvailabilityCode.WRONG_OWNER -> QuestionChatConnectionState.TERMINAL
                    else -> QuestionChatConnectionState.OFFLINE
                }
            )
        )
    }

    private fun startSend(key: QuestionChatBindingKey, expectedGeneration: Long, message: String) {
        val current = mutableState.value
        val session = current.session ?: return
        if (message.isBlank() || session.connection != QuestionChatConnectionState.ONLINE || current.pendingSend != null) return
        val commandId = "android-chat-${commandCounter.incrementAndGet()}"
        mutableState.value = current.copy(
            pendingSend = QuestionChatPendingSend(commandId, message),
            actionUnavailable = null,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val response = httpClient.sendMessage(key.requestId, commandId, message)) {
                    is QuestionChatCommandResult.Accepted -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            draftText = "",
                            pendingSend = null,
                            actionUnavailable = null,
                            actionMessage = when (response.response.mode) {
                                QuestionChatSendMode.STEER -> "Steering the current answer."
                                else -> "Question Chat is answering."
                            },
                            composerFocusToken = mutableState.value.composerFocusToken + 1
                        )
                    }
                    is QuestionChatCommandResult.Unavailable -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            pendingSend = null,
                            actionUnavailable = response.error,
                            actionMessage = response.error.message,
                            session = mutableState.value.session?.copy(
                                connection = when (response.error.code) {
                                    QuestionChatAvailabilityCode.REQUEST_NOT_PENDING,
                                    QuestionChatAvailabilityCode.WRONG_OWNER -> QuestionChatConnectionState.TERMINAL
                                    QuestionChatAvailabilityCode.EXTENSION_OFFLINE -> QuestionChatConnectionState.OFFLINE
                                    else -> mutableState.value.session?.connection ?: QuestionChatConnectionState.OFFLINE
                                }
                            )
                        )
                    }
                }
            } catch (_: CancellationException) {
                return@launchTracked
            } catch (error: Exception) {
                (error as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                reduceIfCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        pendingSend = null,
                        actionUnavailable = null,
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
            actionUnavailable = null,
            actionMessage = null
        )
        launchTracked {
            try {
                when (val response = httpClient.stop(key.requestId, commandId)) {
                    is QuestionChatCommandResult.Accepted -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            pendingStopCommandId = null,
                            actionUnavailable = null,
                            actionMessage = "Stopping Question Chat…"
                        )
                    }
                    is QuestionChatCommandResult.Unavailable -> reduceIfCurrent(key, expectedGeneration) {
                        mutableState.value = mutableState.value.copy(
                            pendingStopCommandId = null,
                            actionUnavailable = response.error,
                            actionMessage = response.error.message,
                            session = mutableState.value.session?.copy(
                                connection = when (response.error.code) {
                                    QuestionChatAvailabilityCode.REQUEST_NOT_PENDING,
                                    QuestionChatAvailabilityCode.WRONG_OWNER -> QuestionChatConnectionState.TERMINAL
                                    QuestionChatAvailabilityCode.EXTENSION_OFFLINE -> QuestionChatConnectionState.OFFLINE
                                    else -> mutableState.value.session?.connection ?: QuestionChatConnectionState.OFFLINE
                                }
                            )
                        )
                    }
                }
            } catch (_: CancellationException) {
                return@launchTracked
            } catch (error: Exception) {
                (error as? PostboxProtocolMismatchException)?.let { onProtocolMismatch(it.mismatch) }
                reduceIfCurrent(key, expectedGeneration) {
                    mutableState.value = mutableState.value.copy(
                        pendingStopCommandId = null,
                        actionUnavailable = null,
                        actionMessage = error.message ?: "Unable to stop Question Chat."
                    )
                }
            }
        }
    }

    private fun applyLiveEvent(
        key: QuestionChatBindingKey,
        expectedGeneration: Long,
        event: QuestionChatStreamEvent
    ) {
        val session = mutableState.value.session ?: return
        when (event) {
            is QuestionChatStreamEvent.Transport -> {
                if (!event.online) {
                    mutableState.value = mutableState.value.copy(
                        session = session.copy(connection = QuestionChatConnectionState.OFFLINE)
                    )
                } else if (session.connection != QuestionChatConnectionState.ONLINE) {
                    mutableState.value = mutableState.value.copy(
                        session = session.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
                    )
                    scheduleSynchronize(key, expectedGeneration)
                }
            }
            is QuestionChatStreamEvent.Event -> {
                if (session.connection != QuestionChatConnectionState.ONLINE) return
                if (event.payload.sequence > session.snapshot.sequence + 1) {
                    mutableState.value = mutableState.value.copy(
                        session = session.copy(connection = QuestionChatConnectionState.SYNCHRONIZING)
                    )
                    scheduleSynchronize(key, expectedGeneration)
                    return
                }
                val updatedSnapshot = applyQuestionChatEvent(session.snapshot, event.payload)
                mutableState.value = mutableState.value.copy(
                    session = session.copy(snapshot = updatedSnapshot)
                )
                scheduleRenderedAssistantMessageParses(key, expectedGeneration, updatedSnapshot)
            }
        }
    }

    private fun applyBufferedSnapshot(
        snapshot: QuestionChatSnapshot,
        buffered: List<QuestionChatStreamEvent>
    ): BufferedSnapshotApplication {
        var current = snapshot
        var connection = QuestionChatConnectionState.ONLINE
        buffered.filterIsInstance<QuestionChatStreamEvent.Transport>().forEach { event ->
            connection = if (event.online) QuestionChatConnectionState.ONLINE else QuestionChatConnectionState.OFFLINE
        }
        buffered.filterIsInstance<QuestionChatStreamEvent.Event>()
            .sortedBy { it.payload.sequence }
            .forEach { event ->
                if (event.payload.sequence <= current.sequence) return@forEach
                if (event.payload.sequence > current.sequence + 1) {
                    return BufferedSnapshotApplication(current, connection, true)
                }
                current = applyQuestionChatEvent(current, event.payload)
            }
        return BufferedSnapshotApplication(current, connection, false)
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
                val rendered = withContext(markdownParserDispatcher) {
                    markdownParser.parse(message.text)
                }
                reduceIfCurrent(key, expectedGeneration) {
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

    private fun isCurrent(key: QuestionChatBindingKey, expectedGeneration: Long): Boolean =
        mutableState.value.key == key && generation == expectedGeneration

    private fun isCurrentSynchronizeAttempt(
        key: QuestionChatBindingKey,
        expectedGeneration: Long,
        expectedAttemptId: Long
    ): Boolean = isCurrent(key, expectedGeneration) && synchronizeAttempt == expectedAttemptId

    private suspend fun reduceIfCurrent(key: QuestionChatBindingKey, expectedGeneration: Long, mutation: () -> Unit) {
        reducerLock.withLock {
            if (isCurrent(key, expectedGeneration)) {
                mutation()
            }
        }
    }

    private suspend fun reduceIfCurrentSynchronizeAttempt(
        key: QuestionChatBindingKey,
        expectedGeneration: Long,
        expectedAttemptId: Long,
        mutation: () -> Unit
    ) {
        reducerLock.withLock {
            if (isCurrentSynchronizeAttempt(key, expectedGeneration, expectedAttemptId)) {
                mutation()
            }
        }
    }

    private fun reduce(mutation: () -> Unit) {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            reducerLock.withLock {
                mutation()
            }
        }
    }

    private fun launchTracked(block: suspend () -> Unit): Job {
        mutableIdle.value = false
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            val thisJob = coroutineContext[Job]
            try {
                block()
            } finally {
                reduce {
                    activeJobs.remove(thisJob)
                    mutableIdle.value = activeJobs.isEmpty()
                }
            }
        }
        activeJobs += job
        return job
    }

    private fun cancelActiveWork() {
        activeJobs.forEach { it.cancel() }
        activeJobs.clear()
        synchronizeJob = null
        eventConnection?.close()
        eventConnection = null
        mutableIdle.value = true
    }
}

private data class BufferedSynchronization(
    val events: MutableList<QuestionChatStreamEvent> = mutableListOf(),
    var requiresResync: Boolean = false,
    var streamEnded: Boolean = false,
    var streamFailure: Throwable? = null
)

private data class BufferedSnapshotApplication(
    val snapshot: QuestionChatSnapshot,
    val connection: QuestionChatConnectionState,
    val requiresResync: Boolean
)

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

package dev.pi.postbox.questionchat

import dev.pi.postbox.protocol.GeneratedPostboxProtocolContract
import dev.pi.postbox.protocol.ProtocolMessageSource
import dev.pi.postbox.protocol.ProtocolMismatch
import dev.pi.postbox.protocol.ProtocolMismatchReason
import java.time.Instant
import java.util.concurrent.Executors
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.ContinuationInterceptor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val TEST_BASE_URL = "https://postbox.tailnet.example:32187/"

@OptIn(ExperimentalCoroutinesApi::class)
class QuestionChatOwnerTest {
    @Test
    fun bindWhileForegroundProbesAndShowsNotStartedWhenNoRuntimeExists() = runTest {
        val client = FakeQuestionChatHttpClient(probeResult = QuestionChatProbeResult.NotStarted)
        val owner = QuestionChatOwner(client, FakeQuestionChatEventTransport(), backgroundScope)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        val state = owner.state.value
        assertEquals(QuestionChatActivationUiState.Idle, state.activation)
        assertFalse(state.knownStarted)
        assertNull(state.session)
        assertEquals(listOf("ask-1"), client.probeCalls)
    }

    @Test
    fun exactActivationStaysUnavailableOnTypedSourceFailure() = runTest {
        val client = FakeQuestionChatHttpClient(
            exactActivation = QuestionChatActivationResult.Unavailable(
                QuestionChatAvailabilityError(
                    code = QuestionChatAvailabilityCode.SOURCE_LEAF_MISSING,
                    message = "Leaf missing."
                )
            )
        )
        val owner = QuestionChatOwner(client, FakeQuestionChatEventTransport(), backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.ActivateExact)
        advanceUntilIdle()

        assertTrue(owner.state.value.activation is QuestionChatActivationUiState.Unavailable)
        assertFalse(owner.state.value.knownStarted)
    }

    @Test
    fun exactActivationTransitionsIntoKnownStartedOnlineState() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot(sequence = 1)
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.NotStarted,
            exactActivation = QuestionChatActivationResult.Ready(snapshot),
            snapshot = snapshot
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.ActivateExact)
        advanceUntilIdle()

        assertTrue(owner.state.value.knownStarted)
        assertEquals(QuestionChatConnectionState.ONLINE, owner.state.value.session?.connection)
    }

    @Test
    fun sendUsesOwnerCommandIdAndWaitsForAuthoritativeTranscript() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot()
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(snapshot),
            snapshot = snapshot,
            sendResult = QuestionChatCommandResult.Accepted(
                QuestionChatSendResponse(clientCommandId = "android-chat-1", mode = QuestionChatSendMode.TURN)
            )
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.DraftChanged("Explain this"))
        owner.dispatch(QuestionChatIntent.SendDraft)
        advanceUntilIdle()

        assertEquals(listOf(RecordedSend("ask-1", "android-chat-1", "Explain this")), client.sendCalls)
        assertTrue(owner.state.value.session?.snapshot?.messages?.isEmpty() == true)
        assertEquals("", owner.state.value.draftText)
        assertNull(owner.state.value.pendingSend)
        assertNull(owner.state.value.actionMessage)

        transport.emitEvent(
            QuestionChatStreamEvent.Event(
                requestId = "ask-1",
                payload = QuestionChatEvent.MessageStarted(
                    requestId = "ask-1",
                    sequence = 1,
                    message = QuestionChatMessage.User(id = "server-user-1", text = "Explain this")
                )
            )
        )
        advanceUntilIdle()

        assertEquals(1, owner.state.value.session?.snapshot?.messages?.size)
    }

    @Test
    fun rebindingRejectsStaleCallbacksAndReleasesOldOwnerState() = runTest {
        val transport = FakeQuestionChatEventTransport()
        val firstSnapshot = readySnapshot(requestId = "ask-1")
        val secondSnapshot = readySnapshot(requestId = "ask-2")
        val firstSnapshotGate = CompletableDeferred<Unit>()
        val client = FakeQuestionChatHttpClient(
            probeResultFactory = { requestId ->
                if (requestId == "ask-1") QuestionChatProbeResult.Ready(firstSnapshot) else QuestionChatProbeResult.Ready(secondSnapshot)
            },
            snapshotFactory = { requestId ->
                if (requestId == "ask-1") {
                    firstSnapshotGate.await()
                    firstSnapshot
                } else {
                    secondSnapshot
                }
            }
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        transport.openReady.complete(Unit)
        runCurrent()

        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-2"))
        advanceUntilIdle()
        firstSnapshotGate.complete(Unit)
        advanceUntilIdle()

        assertEquals("ask-2", owner.state.value.key?.requestId)
        assertEquals("ask-2", owner.state.value.session?.snapshot?.requestId)
    }

    @Test
    fun stopUsesOwnerCommandIdAndWaitsForAuthoritativeLifecycle() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val generating = readySnapshot(sequence = 4, state = QuestionChatState.GENERATING)
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(generating),
            snapshot = generating
        )
        val owner = QuestionChatOwner(
            httpClient = client,
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.Stop)
        advanceUntilIdle()

        assertEquals(listOf(RecordedStop("ask-1", "android-stop-1")), client.stopCalls)
        assertEquals(QuestionChatState.GENERATING, owner.state.value.session?.snapshot?.state)
    }

    @Test
    fun incompatibleMidstreamFactHardBlocksOwnerAndIgnoresLaterEventsAndCommands() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot()
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(snapshot),
            snapshot = snapshot
        )
        val mismatches = mutableListOf<ProtocolMismatch>()
        val owner = QuestionChatOwner(client, transport, backgroundScope, onProtocolMismatch = mismatches::add)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        transport.emitIncompatible()
        transport.emitEvent(
            QuestionChatStreamEvent.Event(
                "ask-1",
                QuestionChatEvent.Lifecycle("ask-1", 99, QuestionChatState.GENERATING)
            )
        )
        owner.dispatch(QuestionChatIntent.DraftChanged("must not send"))
        owner.dispatch(QuestionChatIntent.SendDraft)
        advanceUntilIdle()

        assertEquals(1, mismatches.size)
        assertNull(owner.state.value.session)
        assertTrue(client.sendCalls.isEmpty())
    }

    @Test
    fun backgroundingCancelsInFlightSendAndMarksRetainedSnapshotOffline() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot()
        val sendEntered = CompletableDeferred<Unit>()
        val sendCancelled = CompletableDeferred<Unit>()
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(snapshot),
            snapshot = snapshot,
            sendBlock = {
                sendEntered.complete(Unit)
                try {
                    awaitCancellation()
                } finally {
                    sendCancelled.complete(Unit)
                }
            }
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.DraftChanged("Explain this"))
        owner.dispatch(QuestionChatIntent.SendDraft)
        sendEntered.await()

        owner.dispatch(QuestionChatIntent.SetForeground(false))
        sendCancelled.await()
        advanceUntilIdle()

        assertEquals(QuestionChatConnectionState.OFFLINE, owner.state.value.session?.connection)
        assertNull(owner.state.value.pendingSend)
    }

    @Test
    fun foregroundResumeResynchronizesRetainedSnapshotAfterBackgroundClose() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot()
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(snapshot),
            snapshot = snapshot
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.SetForeground(false))
        advanceUntilIdle()
        assertEquals(QuestionChatConnectionState.OFFLINE, owner.state.value.session?.connection)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        advanceUntilIdle()

        assertEquals(2, transport.openCount)
        assertEquals(QuestionChatConnectionState.ONLINE, owner.state.value.session?.connection)
    }

    @Test
    fun malformedTransportFactDuringSynchronizeForcesFreshResyncBeforeOnline() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val initial = readySnapshot(sequence = 1)
        var fetches = 0
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(initial),
            snapshotFactory = {
                fetches += 1
                if (fetches == 1) {
                    transport.emitStale("Malformed Question Chat JSON")
                }
                initial.copy(sequence = fetches)
            }
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        assertTrue(client.fetchSnapshotCalls.size >= 2)
        assertEquals(QuestionChatConnectionState.ONLINE, owner.state.value.session?.connection)
        assertEquals(fetches, owner.state.value.session?.snapshot?.sequence)
    }

    @Test
    fun bufferedOfflineTransportFactNeverDeclaresFalseOnlineState() = runTest {
        val transport = FakeQuestionChatEventTransport()
        val snapshot = readySnapshot(sequence = 3)
        val snapshotGate = CompletableDeferred<Unit>()
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(snapshot),
            snapshotFactory = {
                snapshotGate.await()
                snapshot
            }
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        transport.openReady.complete(Unit)
        runCurrent()

        transport.emitEvent(QuestionChatStreamEvent.Transport(requestId = "ask-1", online = false))
        snapshotGate.complete(Unit)
        advanceUntilIdle()

        assertTrue(owner.state.value.session?.connection != QuestionChatConnectionState.ONLINE)
    }

    @Test
    fun lateEventsAfterOfflineTransportAreIgnored() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot(sequence = 0)
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        transport.emitEvent(QuestionChatStreamEvent.Transport(requestId = "ask-1", online = false))
        transport.emitEvent(
            QuestionChatStreamEvent.Event(
                requestId = "ask-1",
                payload = QuestionChatEvent.MessageStarted(
                    requestId = "ask-1",
                    sequence = 1,
                    message = QuestionChatMessage.User(id = "late-user-1", text = "Late while offline")
                )
            )
        )
        advanceUntilIdle()

        assertEquals(QuestionChatConnectionState.OFFLINE, owner.state.value.session?.connection)
        assertEquals(0, owner.state.value.session?.snapshot?.sequence)
        assertTrue(owner.state.value.session?.snapshot?.messages?.isEmpty() == true)
    }

    @Test
    fun retrySupersedesOlderSynchronizeAttemptForSameGeneration() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val initial = readySnapshot(sequence = 0)
        val older = readySnapshot(
            sequence = 1,
            messages = listOf(assistantMessage(text = "Older retry result", status = QuestionChatMessage.Assistant.Status.FINAL))
        )
        val newer = readySnapshot(
            sequence = 2,
            messages = listOf(assistantMessage(id = "assistant-2", text = "Newer retry result", status = QuestionChatMessage.Assistant.Status.FINAL))
        )
        val firstFetchGate = CompletableDeferred<Unit>()
        var fetches = 0
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(initial),
                snapshotFactory = {
                    fetches += 1
                    when (fetches) {
                        1 -> {
                            firstFetchGate.await()
                            older
                        }
                        2 -> newer
                        else -> error("Unexpected fetch $fetches")
                    }
                }
            ),
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        runCurrent()

        owner.dispatch(QuestionChatIntent.Retry)
        advanceUntilIdle()

        assertEquals(2, owner.state.value.session?.snapshot?.sequence)
        assertEquals("Newer retry result", (owner.state.value.session?.snapshot?.messages?.single() as? QuestionChatMessage.Assistant)?.text)

        firstFetchGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(2, owner.state.value.session?.snapshot?.sequence)
        assertEquals("Newer retry result", (owner.state.value.session?.snapshot?.messages?.single() as? QuestionChatMessage.Assistant)?.text)
    }

    @Test
    fun fetchSnapshotUnavailablePreservesTypedOwnerError() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val initial = readySnapshot(sequence = 1)
        val error = QuestionChatAvailabilityError(
            code = QuestionChatAvailabilityCode.EXTENSION_OFFLINE,
            message = "Extension offline."
        )
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(initial),
                snapshotResult = QuestionChatSnapshotResult.Unavailable(error)
            ),
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        assertEquals(QuestionChatActivationUiState.Unavailable(error), owner.state.value.activation)
        assertEquals(QuestionChatConnectionState.OFFLINE, owner.state.value.session?.connection)
    }

    @Test
    fun sendUnavailablePreservesTypedOwnerError() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot()
        val error = QuestionChatAvailabilityError(
            code = QuestionChatAvailabilityCode.RATE_LIMITED,
            message = "Slow down.",
            retryAfterMs = 1500
        )
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot,
                sendResult = QuestionChatCommandResult.Unavailable(error)
            ),
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()
        owner.dispatch(QuestionChatIntent.DraftChanged("Explain this"))
        owner.dispatch(QuestionChatIntent.SendDraft)
        advanceUntilIdle()

        assertEquals(error, owner.state.value.actionUnavailable)
        assertEquals("Slow down.", owner.state.value.actionMessage)
        assertNull(owner.state.value.pendingSend)
    }

    @Test
    fun stopUnavailablePreservesTypedOwnerError() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot(state = QuestionChatState.GENERATING)
        val error = QuestionChatAvailabilityError(
            code = QuestionChatAvailabilityCode.REQUEST_NOT_PENDING,
            message = "Already terminal."
        )
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot,
                stopResult = QuestionChatCommandResult.Unavailable(error)
            ),
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()
        owner.dispatch(QuestionChatIntent.Stop)
        advanceUntilIdle()

        assertEquals(error, owner.state.value.actionUnavailable)
        assertEquals(QuestionChatConnectionState.TERMINAL, owner.state.value.session?.connection)
        assertNull(owner.state.value.pendingStopCommandId)
    }

    @Test
    fun sequenceGapTriggersFreshSnapshotResynchronization() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val initial = readySnapshot(
            requestId = "ask-1",
            sequence = 4,
            messages = listOf(assistantMessage(text = "Before gap", status = QuestionChatMessage.Assistant.Status.FINAL))
        )
        val resynced = readySnapshot(
            requestId = "ask-1",
            sequence = 7,
            messages = listOf(assistantMessage(id = "assistant-2", text = "Recovered after gap", status = QuestionChatMessage.Assistant.Status.FINAL))
        )
        var fetches = 0
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.Ready(initial),
            snapshotFactory = { requestId ->
                if (requestId != "ask-1") error("Unexpected request $requestId")
                fetches += 1
                if (fetches == 1) initial else resynced
            }
        )
        val owner = QuestionChatOwner(
            httpClient = client,
            eventTransport = transport,
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        transport.emitEvent(
            QuestionChatStreamEvent.Event(
                requestId = "ask-1",
                payload = QuestionChatEvent.MessageFinished(
                    requestId = "ask-1",
                    sequence = 7,
                    messageId = "assistant-2",
                    text = "Recovered after gap",
                    status = QuestionChatMessage.Assistant.Status.FINAL
                )
            )
        )
        advanceUntilIdle()

        assertTrue(client.fetchSnapshotCalls.size >= 2)
        assertEquals(7, owner.state.value.session?.snapshot?.sequence)
        assertEquals("Recovered after gap", (owner.state.value.session?.snapshot?.messages?.single() as? QuestionChatMessage.Assistant)?.text)
    }

    @Test
    fun terminalAssistantMessagesReceiveSafeMarkdownRenderings() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot(
            messages = listOf(
                QuestionChatMessage.Assistant(
                    id = "assistant-1",
                    text = "**Done** with [link](https://example.com).",
                    status = QuestionChatMessage.Assistant.Status.FINAL
                )
            )
        )
        val owner = QuestionChatOwner(
            httpClient = FakeQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope,
            markdownParserDispatcher = backgroundScope.coroutineContext[ContinuationInterceptor] as kotlinx.coroutines.CoroutineDispatcher
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        val rendered = owner.state.value.renderedAssistantMessages["assistant-1"]?.rendered
        assertTrue(rendered is SafeMarkdownRenderResult.Rich)
    }

    @Test
    fun terminalAssistantMessagesParseOnInjectedMarkdownDispatcher() = runBlocking {
        val ownerDispatcher = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "owner-scope-thread")
        }.asCoroutineDispatcher()
        val markdownDispatcher = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "markdown-parser-thread")
        }.asCoroutineDispatcher()
        val ownerScope = CoroutineScope(SupervisorJob() + ownerDispatcher)
        var owner: QuestionChatOwner? = null
        try {
            val parseThreadName = CompletableDeferred<String>()
            val parser = object : SafeMarkdownParser() {
                override fun parse(source: String): SafeMarkdownRenderResult {
                    parseThreadName.complete(Thread.currentThread().name)
                    return super.parse(source)
                }
            }
            val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
            val snapshot = readySnapshot(
                messages = listOf(
                    QuestionChatMessage.Assistant(
                        id = "assistant-1",
                        text = "**Done** with [link](https://example.com).",
                        status = QuestionChatMessage.Assistant.Status.FINAL
                    )
                )
            )
            owner = QuestionChatOwner(
                httpClient = FakeQuestionChatHttpClient(
                    probeResult = QuestionChatProbeResult.Ready(snapshot),
                    snapshot = snapshot
                ),
                eventTransport = transport,
                scope = ownerScope,
                markdownParser = parser,
                markdownParserDispatcher = markdownDispatcher
            )

            owner.dispatch(QuestionChatIntent.SetForeground(true))
            owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))

            withTimeout(5_000) {
                while (owner.state.value.renderedAssistantMessages["assistant-1"] == null) {
                    delay(10)
                }
            }

            assertTrue(parseThreadName.await().startsWith("markdown-parser-thread"))
        } finally {
            owner?.close()
            ownerScope.cancel()
            ownerDispatcher.close()
            markdownDispatcher.close()
        }
    }
}

private fun readySnapshot(
    requestId: String = "ask-1",
    sequence: Int = 0,
    state: QuestionChatState = QuestionChatState.READY,
    messages: List<QuestionChatMessage> = emptyList()
): QuestionChatSnapshot = QuestionChatSnapshot(
    requestId = requestId,
    state = state,
    forkKind = QuestionChatForkKind.FRESH,
    model = QuestionChatModel(id = "anthropic/claude-sonnet-4", source = QuestionChatModelSource.POSTBOX_SETTINGS),
    sequence = sequence,
    messages = messages,
    tools = emptyList()
)

private fun assistantMessage(
    id: String = "assistant-1",
    text: String,
    status: QuestionChatMessage.Assistant.Status = QuestionChatMessage.Assistant.Status.STREAMING
): QuestionChatMessage.Assistant = QuestionChatMessage.Assistant(id = id, text = text, status = status)

private data class RecordedSend(val requestId: String, val clientCommandId: String, val message: String)
private data class RecordedStop(val requestId: String, val clientCommandId: String)

private class FakeQuestionChatHttpClient(
    private val probeResult: QuestionChatProbeResult = QuestionChatProbeResult.NotStarted,
    private val exactActivation: QuestionChatActivationResult = QuestionChatActivationResult.Ready(readySnapshot()),
    private val snapshot: QuestionChatSnapshot = readySnapshot(),
    private val snapshotResult: QuestionChatSnapshotResult? = null,
    private val sendResult: QuestionChatCommandResult<QuestionChatSendResponse> = QuestionChatCommandResult.Accepted(
        QuestionChatSendResponse("android-chat-1", QuestionChatSendMode.TURN)
    ),
    private val stopResult: QuestionChatCommandResult<QuestionChatStopResponse> = QuestionChatCommandResult.Accepted(
        QuestionChatStopResponse("android-stop-1")
    ),
    private val probeResultFactory: (suspend (String) -> QuestionChatProbeResult)? = null,
    private val snapshotFactory: (suspend (String) -> QuestionChatSnapshot)? = null,
    private val sendBlock: (suspend () -> Unit)? = null
) : QuestionChatHttpClient {
    val probeCalls = mutableListOf<String>()
    val fetchSnapshotCalls = mutableListOf<String>()
    val sendCalls = mutableListOf<RecordedSend>()
    val stopCalls = mutableListOf<RecordedStop>()

    override suspend fun activateExact(requestId: String): QuestionChatActivationResult = exactActivation

    override suspend fun probeSnapshot(requestId: String): QuestionChatProbeResult {
        probeCalls += requestId
        return probeResultFactory?.invoke(requestId) ?: probeResult
    }

    override suspend fun fetchSnapshot(requestId: String): QuestionChatSnapshotResult {
        fetchSnapshotCalls += requestId
        return snapshotFactory?.invoke(requestId)?.let(QuestionChatSnapshotResult::Ready)
            ?: snapshotResult
            ?: QuestionChatSnapshotResult.Ready(snapshot)
    }

    override suspend fun sendMessage(requestId: String, clientCommandId: String, message: String): QuestionChatCommandResult<QuestionChatSendResponse> {
        sendCalls += RecordedSend(requestId, clientCommandId, message)
        sendBlock?.invoke()
        return sendResult
    }

    override suspend fun stop(requestId: String, clientCommandId: String): QuestionChatCommandResult<QuestionChatStopResponse> {
        stopCalls += RecordedStop(requestId, clientCommandId)
        return stopResult
    }
}

private class FakeQuestionChatEventTransport : QuestionChatEventTransport {
    val openReady = CompletableDeferred<Unit>()
    var openCount = 0
        private set
    private var listener: ((QuestionChatEventTransportFact) -> Unit)? = null

    override fun open(requestId: String, onFact: (QuestionChatEventTransportFact) -> Unit): QuestionChatEventConnection {
        openCount += 1
        listener = onFact
        return object : QuestionChatEventConnection {
            override val ready: CompletableDeferred<Unit> = openReady
            override fun close() = Unit
            override suspend fun join() = Unit
        }
    }

    fun emitEvent(event: QuestionChatStreamEvent) {
        listener?.invoke(QuestionChatEventTransportFact.Event(event))
    }

    fun emitStale(message: String) {
        listener?.invoke(QuestionChatEventTransportFact.Stale(QuestionChatTransportException(message)))
    }

    fun emitIncompatible() {
        listener?.invoke(
            QuestionChatEventTransportFact.IncompatibleProtocol(
                ProtocolMismatch(
                    supportedVersion = GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION,
                    receivedVersion = "0.0.1",
                    source = ProtocolMessageSource.QUESTION_CHAT_STREAM,
                    observedAt = Instant.parse("2026-08-25T12:00:00Z"),
                    reason = ProtocolMismatchReason.DIFFERENT_VERSION
                )
            )
        )
    }
}

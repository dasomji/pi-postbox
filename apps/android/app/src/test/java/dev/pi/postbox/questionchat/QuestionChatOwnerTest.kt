package dev.pi.postbox.questionchat

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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
    fun exactActivationOffersExplicitContextFallbackOnTypedSourceFailure() = runTest {
        val client = FakeQuestionChatHttpClient(
            exactActivation = QuestionChatActivationResult.Unavailable(
                QuestionChatAvailabilityError(
                    code = QuestionChatAvailabilityCode.SOURCE_LEAF_MISSING,
                    message = "Leaf missing.",
                    contextFallback = QuestionChatContextFallbackAvailability.Available
                )
            )
        )
        val owner = QuestionChatOwner(client, FakeQuestionChatEventTransport(), backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.ActivateExact)
        advanceUntilIdle()

        assertTrue(owner.state.value.activation is QuestionChatActivationUiState.AwaitingContextFallbackConfirmation)
        assertFalse(owner.state.value.knownStarted)
    }

    @Test
    fun contextActivationTransitionsIntoKnownStartedOnlineState() = runTest {
        val transport = FakeQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val snapshot = readySnapshot(sequence = 1)
        val client = FakeQuestionChatHttpClient(
            probeResult = QuestionChatProbeResult.NotStarted,
            contextActivation = QuestionChatActivationResult.Ready(snapshot),
            snapshot = snapshot
        )
        val owner = QuestionChatOwner(client, transport, backgroundScope)
        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        owner.dispatch(QuestionChatIntent.ActivateContextFallback)
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
            sendResponse = QuestionChatSendResponse(clientCommandId = "android-chat-1", mode = QuestionChatSendMode.TURN)
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
            scope = backgroundScope
        )

        owner.dispatch(QuestionChatIntent.SetForeground(true))
        owner.bind(QuestionChatBindingKey(TEST_BASE_URL, "ask-1"))
        advanceUntilIdle()

        val rendered = owner.state.value.renderedAssistantMessages["assistant-1"]?.rendered
        assertTrue(rendered is SafeMarkdownRenderResult.Rich)
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
    forkKind = QuestionChatForkKind.EXACT,
    model = QuestionChatModel(id = "anthropic/claude-sonnet-4", source = QuestionChatModelSource.ORIGINATING),
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

private class FakeQuestionChatHttpClient(
    private val probeResult: QuestionChatProbeResult = QuestionChatProbeResult.NotStarted,
    private val exactActivation: QuestionChatActivationResult = QuestionChatActivationResult.Ready(readySnapshot()),
    private val contextActivation: QuestionChatActivationResult = QuestionChatActivationResult.Ready(readySnapshot()),
    private val snapshot: QuestionChatSnapshot = readySnapshot(),
    private val sendResponse: QuestionChatSendResponse = QuestionChatSendResponse("android-chat-1", QuestionChatSendMode.TURN),
    private val probeResultFactory: (suspend (String) -> QuestionChatProbeResult)? = null,
    private val snapshotFactory: (suspend (String) -> QuestionChatSnapshot)? = null
) : QuestionChatHttpClient {
    val probeCalls = mutableListOf<String>()
    val sendCalls = mutableListOf<RecordedSend>()

    override suspend fun activateExact(requestId: String): QuestionChatActivationResult = exactActivation

    override suspend fun activateContext(requestId: String): QuestionChatActivationResult = contextActivation

    override suspend fun probeSnapshot(requestId: String): QuestionChatProbeResult {
        probeCalls += requestId
        return probeResultFactory?.invoke(requestId) ?: probeResult
    }

    override suspend fun fetchSnapshot(requestId: String): QuestionChatSnapshot = snapshotFactory?.invoke(requestId) ?: snapshot

    override suspend fun sendMessage(requestId: String, clientCommandId: String, message: String): QuestionChatSendResponse {
        sendCalls += RecordedSend(requestId, clientCommandId, message)
        return sendResponse
    }

    override suspend fun stop(requestId: String, clientCommandId: String): QuestionChatStopResponse {
        error("Stop is out of scope for this slice")
    }
}

private class FakeQuestionChatEventTransport : QuestionChatEventTransport {
    val openReady = CompletableDeferred<Unit>()
    private var listener: ((QuestionChatEventTransportFact) -> Unit)? = null

    override fun open(requestId: String, onFact: (QuestionChatEventTransportFact) -> Unit): QuestionChatEventConnection {
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
}

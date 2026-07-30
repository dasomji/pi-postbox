package dev.pi.postbox.question

import dev.pi.postbox.questionchat.QuestionChatEventConnection
import dev.pi.postbox.questionchat.QuestionChatEventTransport
import dev.pi.postbox.questionchat.QuestionChatEventTransportFact
import dev.pi.postbox.questionchat.QuestionChatHttpClient
import dev.pi.postbox.questionchat.QuestionChatModel
import dev.pi.postbox.questionchat.QuestionChatModelSource
import dev.pi.postbox.questionchat.QuestionChatOwner
import dev.pi.postbox.questionchat.QuestionChatProbeResult
import dev.pi.postbox.questionchat.QuestionChatActivationResult
import dev.pi.postbox.questionchat.QuestionChatCommandResult
import dev.pi.postbox.questionchat.QuestionChatSendMode
import dev.pi.postbox.questionchat.QuestionChatSendResponse
import dev.pi.postbox.questionchat.QuestionChatSnapshot
import dev.pi.postbox.questionchat.QuestionChatSnapshotResult
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.QuestionChatForkKind
import dev.pi.postbox.questionchat.QuestionChatStopResponse
import dev.pi.postbox.questionchat.QuestionChatWorkspaceTab
import dev.pi.postbox.protocol.AskAnswerPayload
import dev.pi.postbox.protocol.AskCancelPayload
import dev.pi.postbox.protocol.HealthResponse
import dev.pi.postbox.protocol.PostboxStateStream
import dev.pi.postbox.protocol.PostboxStateStreamStatus
import dev.pi.postbox.protocol.StateSnapshot
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QuestionWorkflowQuestionChatTest {
    @Test
    fun discoveredRuntimeRevealsTabsButKeepsQuestionSelected() = runTest {
        val snapshot = readyChatSnapshot()
        val transport = FakeWorkflowQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val owner = QuestionChatOwner(
            httpClient = FakeWorkflowQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope
        )
        val stateStream = FakeWorkflowStateStream()
        val viewModel = startedViewModel(
            client = RecordingWorkflowQuestionChatClient(questionWorkflowState()),
            stateStream = stateStream,
            questionChatOwner = owner
        )

        advanceUntilIdle()

        val chat = viewModel.state.questionChat ?: error("Expected question chat workspace")
        assertTrue(chat.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.QUESTION, chat.selectedTab)
    }

    @Test
    fun activatingQuestionChatSelectsChatAndBackReturnsToQuestion() = runTest {
        val snapshot = readyChatSnapshot()
        val transport = FakeWorkflowQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val owner = QuestionChatOwner(
            httpClient = FakeWorkflowQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.NotStarted,
                exactActivation = QuestionChatActivationResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope
        )
        val stateStream = FakeWorkflowStateStream()
        val viewModel = startedViewModel(
            client = RecordingWorkflowQuestionChatClient(questionWorkflowState()),
            stateStream = stateStream,
            questionChatOwner = owner
        )

        assertFalse(viewModel.state.questionChat?.tabsVisible ?: true)

        viewModel.startQuestionChat()
        advanceUntilIdle()

        assertEquals(QuestionChatWorkspaceTab.CHAT, viewModel.state.questionChat?.selectedTab)
        assertTrue(viewModel.handleBack())
        assertEquals(QuestionChatWorkspaceTab.QUESTION, viewModel.state.questionChat?.selectedTab)
        assertFalse(viewModel.handleBack())
    }

    @Test
    fun reviewSuggestionSelectsQuestionAndPublishesAuthoritativeHighlightToken() = runTest {
        val snapshot = readyChatSnapshot()
        val transport = FakeWorkflowQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val owner = QuestionChatOwner(
            httpClient = FakeWorkflowQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope
        )
        val stateStream = FakeWorkflowStateStream()
        val client = RecordingWorkflowQuestionChatClient(questionWorkflowState())
        val viewModel = startedViewModel(
            client = client,
            stateStream = stateStream,
            questionChatOwner = owner
        )
        viewModel.startQuestionChat()
        advanceUntilIdle()
        viewModel.reviewQuestionChatSuggestion("tailnet")
        advanceUntilIdle()

        val chat = viewModel.state.questionChat ?: error("Expected question chat workspace")
        assertEquals(QuestionChatWorkspaceTab.QUESTION, chat.selectedTab)
        assertEquals("tailnet", chat.suggestedOptionReview?.optionValue)
        assertTrue((chat.suggestedOptionReview?.token ?: 0L) > 0L)
    }

    @Test
    fun closeKeepsQuestionChatForResumeButDisposeClearsIt() = runTest {
        val snapshot = readyChatSnapshot()
        val transport = FakeWorkflowQuestionChatEventTransport().apply { openReady.complete(Unit) }
        val owner = QuestionChatOwner(
            httpClient = FakeWorkflowQuestionChatHttpClient(
                probeResult = QuestionChatProbeResult.Ready(snapshot),
                snapshot = snapshot
            ),
            eventTransport = transport,
            scope = backgroundScope
        )
        val stateStream = FakeWorkflowStateStream()
        val client = RecordingWorkflowQuestionChatClient(questionWorkflowState())
        val viewModel = startedViewModel(
            client = client,
            stateStream = stateStream,
            questionChatOwner = owner
        )

        viewModel.close()
        advanceUntilIdle()
        assertEquals("ask-single", owner.state.value.key?.requestId)
        assertEquals(dev.pi.postbox.questionchat.QuestionChatConnectionState.OFFLINE, owner.state.value.session?.connection)

        viewModel.start()
        stateStream.emit(dev.pi.postbox.protocol.PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()
        assertEquals(dev.pi.postbox.questionchat.QuestionChatConnectionState.ONLINE, owner.state.value.session?.connection)

        viewModel.dispose()
        advanceUntilIdle()
        assertEquals(null, owner.state.value.key)
        assertEquals(null, owner.state.value.session)
    }

    private suspend fun kotlinx.coroutines.test.TestScope.startedViewModel(
        client: RecordingWorkflowQuestionChatClient,
        stateStream: FakeWorkflowStateStream,
        questionChatOwner: QuestionChatOwner
    ): QuestionWorkflowViewModel {
        val viewModel = QuestionWorkflowViewModel(
            baseUrl = VERIFIED_BASE_URL,
            protocolClient = client,
            stateStream = stateStream,
            coroutineScope = backgroundScope,
            questionChatOwner = questionChatOwner
        )
        viewModel.start()
        stateStream.emit(dev.pi.postbox.protocol.PostboxStateStreamStatus.Connected(client.currentState))
        advanceUntilIdle()
        return viewModel
    }
}

private fun readyChatSnapshot(requestId: String = "ask-single"): QuestionChatSnapshot = QuestionChatSnapshot(
    requestId = requestId,
    state = QuestionChatState.READY,
    forkKind = QuestionChatForkKind.EXACT,
    model = QuestionChatModel(id = "anthropic/claude-sonnet-4", source = QuestionChatModelSource.ORIGINATING),
    sequence = 0,
    messages = emptyList(),
    tools = emptyList()
)

private class FakeWorkflowQuestionChatHttpClient(
    private val probeResult: QuestionChatProbeResult,
    private val exactActivation: QuestionChatActivationResult = QuestionChatActivationResult.Ready(readyChatSnapshot()),
    private val snapshot: QuestionChatSnapshot = readyChatSnapshot()
) : QuestionChatHttpClient {
    override suspend fun activateExact(requestId: String): QuestionChatActivationResult = exactActivation
    override suspend fun activateContext(requestId: String): QuestionChatActivationResult = exactActivation
    override suspend fun probeSnapshot(requestId: String): QuestionChatProbeResult = probeResult
    override suspend fun fetchSnapshot(requestId: String): QuestionChatSnapshotResult = QuestionChatSnapshotResult.Ready(snapshot)
    override suspend fun sendMessage(requestId: String, clientCommandId: String, message: String): QuestionChatCommandResult<QuestionChatSendResponse> =
        QuestionChatCommandResult.Accepted(QuestionChatSendResponse(clientCommandId = clientCommandId, mode = QuestionChatSendMode.TURN))
    override suspend fun stop(requestId: String, clientCommandId: String): QuestionChatCommandResult<QuestionChatStopResponse> =
        QuestionChatCommandResult.Accepted(QuestionChatStopResponse(clientCommandId))
}

private class FakeWorkflowQuestionChatEventTransport : QuestionChatEventTransport {
    val openReady = CompletableDeferred<Unit>()
    override fun open(requestId: String, onFact: (QuestionChatEventTransportFact) -> Unit): QuestionChatEventConnection =
        object : QuestionChatEventConnection {
            override val ready: CompletableDeferred<Unit> = openReady
            override fun close() = Unit
            override suspend fun join() = Unit
        }
}

private class RecordingWorkflowQuestionChatClient(
    var currentState: StateSnapshot
) : dev.pi.postbox.protocol.PostboxProtocolClient {
    override suspend fun fetchHealth(): HealthResponse = healthResponse()
    override suspend fun fetchState(): StateSnapshot = currentState
    override suspend fun answerRequest(requestId: String, payload: AskAnswerPayload) = Unit
    override suspend fun cancelRequest(requestId: String, payload: AskCancelPayload) = Unit
}

private class FakeWorkflowStateStream : PostboxStateStream {
    private val mutableStates = MutableSharedFlow<PostboxStateStreamStatus>(replay = 8)
    override val states: SharedFlow<PostboxStateStreamStatus> = mutableStates
    override fun start() = Unit
    suspend fun emit(status: PostboxStateStreamStatus) {
        mutableStates.emit(status)
    }
    override fun close() = Unit
}

package dev.pi.postbox.questionchat

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class QuestionChatTransportTest {
    private val server = MockWebServer()

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun activationUsesEncodedPathAndDecodesContextFallback() = runTest {
        server.enqueue(jsonResponse(chatReadyResponse(requestId = "ask/slash space")))
        val client = OkHttpQuestionChatHttpClient(server.url("/").toString())

        val response = client.activateExact("ask/slash space")

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected activation request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask%2Fslash%20space/chat", request.path)
        val snapshot = (response as QuestionChatActivationResult.Ready).snapshot
        assertEquals("ask/slash space", snapshot.requestId)
        assertEquals(QuestionChatForkKind.EXACT, snapshot.forkKind)
    }

    @Test
    fun contextActivationPostsConfirmedBody() = runTest {
        server.enqueue(jsonResponse(chatReadyResponse(forkKind = "context-only")))
        val client = OkHttpQuestionChatHttpClient(server.url("/").toString())

        val response = client.activateContext("ask-1")

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected context activation request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask-1/chat/context", request.path)
        assertTrue(request.body.readUtf8().contains("\"confirmed\":true"))
        assertEquals(QuestionChatForkKind.CONTEXT_ONLY, (response as QuestionChatActivationResult.Ready).snapshot.forkKind)
    }

    @Test
    fun probeMapsChatNotStartedUnavailableWithoutThrowing() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(409)
                .setHeader("Content-Type", "application/json; charset=utf-8")
                .setBody(chatUnavailableResponse(code = "chat_not_started", message = "Chat has not started."))
        )
        val client = OkHttpQuestionChatHttpClient(server.url("/").toString())

        val response = client.probeSnapshot("ask-1")

        assertTrue(response is QuestionChatProbeResult.NotStarted)
    }

    @Test
    fun sendDecodesTurnAcknowledge() = runTest {
        server.enqueue(jsonResponse("""{"status":"accepted","clientCommandId":"cmd-1","mode":"turn","unknown":"ignored"}"""))
        val client = OkHttpQuestionChatHttpClient(server.url("/").toString())

        val response = client.sendMessage("ask-1", "cmd-1", "Explain this")

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected send request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask-1/chat/messages", request.path)
        assertTrue(request.body.readUtf8().contains("\"message\":\"Explain this\""))
        assertEquals(QuestionChatSendMode.TURN, response.mode)
    }

    @Test
    fun oversizedAckBodyFailsBeforeDecode() = runTest {
        val tooLargePayload = "x".repeat(QuestionChatTransportLimits.SMALL_JSON_BODY_MAX_BYTES + 1)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json; charset=utf-8")
                .setBody("\"$tooLargePayload\"")
        )
        val client = OkHttpQuestionChatHttpClient(server.url("/").toString())

        try {
            client.sendMessage("ask-1", "cmd-1", "Explain this")
            fail("Expected oversized response to fail")
        } catch (error: QuestionChatTransportException) {
            assertTrue(error.message.orEmpty().contains("too large"))
        }
    }

    @Test
    fun cancellingActivationCancelsTheUnderlyingCall() = runBlocking {
        server.enqueue(
            MockResponse()
                .setSocketPolicy(SocketPolicy.NO_RESPONSE)
        )
        val client = OkHttpQuestionChatHttpClient(
            server.url("/").toString(),
            httpClient = OkHttpClient.Builder().build()
        )

        val job = async {
            client.activateExact("ask-1")
        }
        job.cancel()

        try {
            job.await()
            fail("Expected cancellation")
        } catch (_: CancellationException) {
            // expected
        }
        assertTrue(job.isCancelled)
    }

    @Test
    fun eventTransportParsesUtf8CommentsMultilineAndTransportFacts() = runBlocking {
        val startedEvent = chatEventJson(type = "message.started")
        val streamBody = buildString {
            append(": question-chat-connected\r\n\r\n")
            append("data: ")
            append(startedEvent)
            append("\n\n")
            append("event: ignored\r")
            append("data: {\r")
            append("data: \"requestId\":\"ask-1\",\"sequence\":2,\"type\":\"assistant.text.delta\",\"messageId\":\"a-1\",\"text\":\"Hello\"}\r\r")
        }
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setBody(streamBody)
        )
        val transport = OkHttpQuestionChatEventTransport(server.url("/").toString())
        val facts = mutableListOf<QuestionChatEventTransportFact>()

        val connection = transport.open("ask-1") { facts += it }
        connection.ready.await()
        connection.join()

        assertTrue(facts.first() is QuestionChatEventTransportFact.Open)
        assertTrue(facts.any { it is QuestionChatEventTransportFact.Event && (it.event as QuestionChatStreamEvent.Event).payload is QuestionChatEvent.MessageStarted })
        assertTrue(facts.any {
            it is QuestionChatEventTransportFact.Event &&
                ((it.event as QuestionChatStreamEvent.Event).payload as? QuestionChatEvent.AssistantTextDelta)?.text == "Hello"
        })
        assertTrue(facts.last() is QuestionChatEventTransportFact.EndOfStream)
        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected SSE request")
        assertEquals("/api/requests/ask-1/chat/events", request.path)
        assertEquals("text/event-stream", request.getHeader("Accept"))
    }

    @Test
    fun oversizedEventLineFailsTheTransport() = runBlocking {
        val oversized = "x".repeat(QuestionChatTransportLimits.SSE_LINE_MAX_BYTES + 1)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setBody("data: $oversized\n\n")
        )
        val transport = OkHttpQuestionChatEventTransport(server.url("/").toString())
        val facts = mutableListOf<QuestionChatEventTransportFact>()

        val connection = transport.open("ask-1") { facts += it }
        connection.ready.await()
        connection.join()

        val error = facts.filterIsInstance<QuestionChatEventTransportFact.Failure>().single()
        assertTrue(error.throwable.message.orEmpty().contains("line"))
        assertFalse(facts.any { it is QuestionChatEventTransportFact.Event })
    }
}

private fun jsonResponse(body: String): MockResponse = MockResponse()
    .setResponseCode(200)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .setBody(body)

private fun chatReadyResponse(
    requestId: String = "ask-1",
    forkKind: String = "exact"
): String =
    """
        {
          "status": "ready",
          "snapshot": {
            "requestId": "$requestId",
            "state": "ready",
            "forkKind": "$forkKind",
            "model": {
              "id": "anthropic/claude-sonnet-4",
              "source": "originating"
            },
            "sequence": 0,
            "messages": [],
            "tools": [],
            "unknownField": "ignored"
          }
        }
    """.trimIndent()

private fun chatUnavailableResponse(code: String, message: String): String =
    """
        {
          "status": "unavailable",
          "error": {
            "code": "$code",
            "message": "$message",
            "contextFallback": {
              "status": "available"
            }
          }
        }
    """.trimIndent()

private fun chatEventJson(type: String): String =
    if (type == "message.started") {
        "{" +
            "\"requestId\":\"ask-1\"," +
            "\"sequence\":1," +
            "\"type\":\"message.started\"," +
            "\"message\":{\"id\":\"a-1\",\"role\":\"assistant\",\"text\":\"\",\"status\":\"streaming\"}" +
            "}"
    } else {
        error("Unsupported type $type")
    }

package dev.pi.postbox.protocol

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PostboxProtocolClientTest {
    private val server = MockWebServer()

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun fetchStateRequestsApiStateAndDecodesSnapshot() = runTest {
        server.enqueue(jsonResponse(representativeStateJson()))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        val snapshot = client.fetchState()

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected /api/state request")
        assertEquals("GET", request.method)
        assertEquals("/api/state", request.path)
        assertEquals("ask-protocol-1", snapshot.requests.single().requestId)
        assertEquals(SemanticState.BLOCKED, snapshot.sessions.single().semanticState)
    }

    @Test
    fun answerRequestPostsSelectedValuesAndOptionalNoteAndRationale() = runTest {
        server.enqueue(jsonResponse("""{"result":{"status":"answered"}}"""))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        client.answerRequest(
            requestId = "ask/slash and space",
            payload = AskAnswerPayload(
                selectedValues = listOf("kotlinx", "manual"),
                note = "Ship the native client first.",
                rationale = "It matches the existing protocol schemas."
            )
        )

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected answer request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask%2Fslash%20and%20space/answer", request.path)
        assertTrue(request.getHeader("Content-Type")?.startsWith("application/json") == true)

        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(JsonArray(listOf(JsonPrimitive("kotlinx"), JsonPrimitive("manual"))), body["selectedValues"])
        assertEquals("Ship the native client first.", body["note"]?.jsonPrimitive?.content)
        assertEquals("It matches the existing protocol schemas.", body["rationale"]?.jsonPrimitive?.content)
    }

    @Test
    fun cancelRequestPostsOptionalNoteAndRationale() = runTest {
        server.enqueue(jsonResponse("""{"result":{"status":"cancelled"}}"""))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        client.cancelRequest(
            requestId = "ask-cancel-1",
            payload = AskCancelPayload(
                note = "Pause until design review finishes.",
                rationale = "The answer would be speculative right now."
            )
        )

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected cancel request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask-cancel-1/cancel", request.path)
        assertTrue(request.getHeader("Content-Type")?.startsWith("application/json") == true)

        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("Pause until design review finishes.", body["note"]?.jsonPrimitive?.content)
        assertEquals("The answer would be speculative right now.", body["rationale"]?.jsonPrimitive?.content)
    }

    @Test
    fun answerConflictMapsToAlreadyResolvedDomainError() = runTest {
        server.enqueue(conflictResponse())
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        try {
            client.answerRequest(
                requestId = "ask-protocol-1",
                payload = AskAnswerPayload(selectedValues = listOf("kotlinx"))
            )
            fail("Expected 409 answer response to throw PostboxRequestAlreadyResolvedException")
        } catch (error: PostboxRequestAlreadyResolvedException) {
            assertEquals("ask-protocol-1", error.requestId)
            assertEquals("request_already_resolved", error.serverCode)
        }
    }

    @Test
    fun cancelConflictMapsToAlreadyResolvedDomainError() = runTest {
        server.enqueue(conflictResponse())
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        try {
            client.cancelRequest(
                requestId = "ask-protocol-1",
                payload = AskCancelPayload(note = "Too late")
            )
            fail("Expected 409 cancel response to throw PostboxRequestAlreadyResolvedException")
        } catch (error: PostboxRequestAlreadyResolvedException) {
            assertEquals("ask-protocol-1", error.requestId)
            assertEquals("request_already_resolved", error.serverCode)
        }
    }

    private fun jsonResponse(body: String): MockResponse = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setBody(body)

    private fun conflictResponse(): MockResponse = MockResponse()
        .setResponseCode(409)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setBody(
            """
                {
                  "error": "request_already_resolved",
                  "message": "Request ask-protocol-1 is already resolved"
                }
            """.trimIndent()
        )
}

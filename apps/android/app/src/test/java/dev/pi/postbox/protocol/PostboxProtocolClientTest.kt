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
        val responseJson = representativeStateJson(firstOptionProvenance = "chat")
        server.enqueue(jsonResponse(responseJson))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        val snapshot = client.fetchState()

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected /api/state request")
        assertEquals("GET", request.method)
        assertEquals("/api/state", request.path)
        val decodedQuestion = snapshot.requests.single()
        assertEquals("ask-protocol-1", decodedQuestion.requestId)
        assertEquals(AskOptionProvenance.CHAT, decodedQuestion.options.first().provenance)
        assertEquals("Stay idiomatic on Android.", decodedQuestion.options.first().impact)
        assertEquals(SemanticState.BLOCKED, snapshot.sessions.single().semanticState)
    }

    @Test
    fun foreignStateEnvelopeIsRejectedBeforeInvalidEnumDecode() = runTest {
        val incompatible = representativeStateJson()
            .replace(GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION, "0.0.1")
            .replace("\"semanticState\": \"blocked\"", "\"semanticState\": \"future-secret-state\"")
        server.enqueue(
            MockResponse().setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
                .setBody(incompatible)
        )
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        try {
            client.fetchState()
            fail("Expected protocol mismatch")
        } catch (error: PostboxProtocolMismatchException) {
            assertEquals("0.0.1", error.mismatch.receivedVersion)
            assertTrue(!error.toString().contains("future-secret-state"))
        }
    }

    @Test
    fun answerRequestPostsSelectedValuesAndOptionalNote() = runTest {
        server.enqueue(jsonResponse("""{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}","result":{"status":"answered"}}"""))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        client.answerRequest(
            requestId = "ask/slash and space",
            payload = AskAnswerPayload(
                expectedRevision = 7,
                selectedValues = listOf("kotlinx", "manual"),
                note = "Ship the native client first."
            )
        )

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected answer request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask%2Fslash%20and%20space/answer", request.path)
        assertTrue(request.getHeader("Content-Type")?.startsWith("application/json") == true)
        assertEquals(GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION, request.getHeader(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER))

        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals(7, body["expectedRevision"]?.jsonPrimitive?.content?.toInt())
        assertEquals(JsonArray(listOf(JsonPrimitive("kotlinx"), JsonPrimitive("manual"))), body["selectedValues"])
        assertEquals("Ship the native client first.", body["note"]?.jsonPrimitive?.content)
    }

    @Test
    fun cancelRequestPostsOptionalNote() = runTest {
        server.enqueue(jsonResponse("""{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}","result":{"status":"cancelled"}}"""))
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        client.cancelRequest(
            requestId = "ask-cancel-1",
            payload = AskCancelPayload(
                note = "Pause until design review finishes."
            )
        )

        val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected cancel request")
        assertEquals("POST", request.method)
        assertEquals("/api/requests/ask-cancel-1/cancel", request.path)
        assertTrue(request.getHeader("Content-Type")?.startsWith("application/json") == true)

        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("Pause until design review finishes.", body["note"]?.jsonPrimitive?.content)
    }

    @Test
    fun answerConflictMapsToAlreadyResolvedDomainError() = runTest {
        server.enqueue(conflictResponse())
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        try {
            client.answerRequest(
                requestId = "ask-protocol-1",
                payload = AskAnswerPayload(expectedRevision = 1, selectedValues = listOf("kotlinx"))
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

    @Test
    fun staleRevisionConflictMapsToRefreshableDomainError() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(409)
                .setHeader("Content-Type", "application/json; charset=utf-8")
                .setHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
                .setBody(
                    """{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}","error":"stale_revision","message":"Question revision is stale"}"""
                )
        )
        val client = OkHttpPostboxProtocolClient(baseUrl = server.url("/").toString())

        try {
            client.answerRequest(
                requestId = "ask-protocol-1",
                payload = AskAnswerPayload(expectedRevision = 1, selectedValues = listOf("kotlinx"))
            )
            fail("Expected stale revision conflict")
        } catch (error: PostboxStaleRevisionException) {
            assertEquals("ask-protocol-1", error.requestId)
        }
    }

    private fun jsonResponse(body: String): MockResponse = MockResponse()
        .setResponseCode(200)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
        .setBody(body)

    private fun conflictResponse(): MockResponse = MockResponse()
        .setResponseCode(409)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .setBody(
            """
                {
                  "protocolVersion": "${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}",
                  "error": "request_already_resolved",
                  "message": "Request ask-protocol-1 is already resolved"
                }
            """.trimIndent()
        )
        .setHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
}

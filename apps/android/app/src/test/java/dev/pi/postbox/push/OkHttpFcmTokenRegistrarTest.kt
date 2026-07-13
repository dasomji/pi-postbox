package dev.pi.postbox.push

import dev.pi.postbox.protocol.PostboxProtocolHttpException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OkHttpFcmTokenRegistrarTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `posts the token as an android FCM registration`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))

        OkHttpFcmTokenRegistrar().register(server.url("/").toString(), "device-token-1")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/push/fcm-tokens", request.path)

        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("device-token-1", body["token"]?.jsonPrimitive?.content)
        assertEquals("android", body["platform"]?.jsonPrimitive?.content)
    }

    @Test
    fun `throws on non-success responses`() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"invalid_fcm_token"}"""))

        val result = runCatching { OkHttpFcmTokenRegistrar().register(server.url("/").toString(), "device-token-1") }

        val error = result.exceptionOrNull()
        assertTrue(error is PostboxProtocolHttpException)
        assertEquals(400, (error as PostboxProtocolHttpException).statusCode)
    }
}

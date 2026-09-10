package dev.pi.postbox.settings

import dev.pi.postbox.protocol.GeneratedPostboxProtocolContract
import dev.pi.postbox.protocol.POSTBOX_PROTOCOL_VERSION_HEADER
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class PostboxSettingsClientTest {
    private fun response(code: Int = 200, revision: Int = 1) = MockResponse().setResponseCode(code)
        .addHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
        .setBody("""{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}","revision":$revision,"chat":{"model":"test/model","effort":"high"}}""")

    @Test fun refreshesModelsAndDistinguishesEmptyCatalogFromFailure() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val client = PostboxSettingsClient(server.url("/").toString())
            fun catalog(body: String, code: Int = 200) = MockResponse().setResponseCode(code)
                .addHeader(POSTBOX_PROTOCOL_VERSION_HEADER, GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION)
                .setBody("""{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}",${body.drop(1)}""")
            server.enqueue(catalog("""{"models":[{"id":"test/current","name":"Current"}]}"""))
            assertEquals(listOf(AvailableChatModel("test/current", "Current")), client.fetchModels())
            assertEquals("/api/settings/models", server.takeRequest().path)
            server.enqueue(catalog("""{"models":[]}"""))
            assertTrue(client.fetchModels().isEmpty())
            server.enqueue(catalog("""{"error":"models_unavailable"}""", 503))
            try { client.fetchModels(); fail("Expected catalog failure") }
            catch (error: java.io.IOException) { assertTrue(error.message!!.contains("Could not load available models")) }
        } finally { server.shutdown() }
    }

    @Test fun readsAndWritesTheServerSettingsContract() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val client = PostboxSettingsClient(server.url("/").toString())
            server.enqueue(response())
            val settings = client.fetch()
            assertEquals(PostboxSettings(1, ChatDefaults("test/model", "high")), settings)
            assertEquals("/api/settings", server.takeRequest().path)
            server.enqueue(response(revision = 2))
            assertEquals(2, client.save(settings).revision)
            val write = server.takeRequest()
            assertEquals("PUT", write.method)
            assertEquals("""{"revision":1,"chat":{"model":"test/model","effort":"high"}}""", write.body.readUtf8())
            server.enqueue(response(code = 409))
            try { client.save(settings); fail("Expected stale settings rejection") }
            catch (error: java.io.IOException) { assertTrue(error.message!!.contains("another device")) }
        } finally { server.shutdown() }
    }
}

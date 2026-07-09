package dev.pi.postbox.protocol

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.system.measureTimeMillis
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PostboxStateStreamTest {
    private val server = MockWebServer()

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun stateStreamConsumesInitialAndUpdateEventsAsLatestState() = runBlocking {
        val initial = representativeStateJson(
            timestamp = "2026-06-25T12:00:00.000Z",
            requestId = "ask-initial"
        )
        val update = representativeStateJson(
            timestamp = "2026-06-25T12:00:05.000Z",
            requestId = "ask-update"
        )
        server.enqueue(sseResponse(initial, update))
        val stream = OkHttpPostboxStateStream(baseUrl = server.url("/").toString())
        val connectedStates = mutableListOf<PostboxStateStreamStatus.Connected>()

        val collection = launch {
            stream.states
                .filterIsInstance<PostboxStateStreamStatus.Connected>()
                .take(2)
                .toList(connectedStates)
        }

        try {
            stream.start()
            withTimeout(2.seconds) { collection.join() }

            val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected SSE state request")
            assertEquals("GET", request.method)
            assertEquals("/api/state/events", request.path)
            assertEquals("2026-06-25T12:00:00.000Z", connectedStates[0].latestState.timestamp)
            assertEquals("ask-initial", connectedStates[0].latestState.requests.single().requestId)
            assertEquals("2026-06-25T12:00:05.000Z", connectedStates[1].latestState.timestamp)
            assertEquals("ask-update", connectedStates[1].latestState.requests.single().requestId)
        } finally {
            stream.close()
        }
    }

    @Test
    fun stateStreamRecoversFromMalformedSseEventAndConsumesNextValidState() = runBlocking {
        val validState = representativeStateJson(
            timestamp = "2026-06-25T12:01:00.000Z",
            requestId = "ask-after-malformed"
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setBody(
                    "event: state\n" +
                        "data: {not-json}\n\n" +
                        "event: state\n" +
                        "data: ${compactJson(validState)}\n\n"
                )
        )
        val stream = OkHttpPostboxStateStream(baseUrl = server.url("/").toString())
        val malformedStatuses = mutableListOf<PostboxStateStreamStatus.Reconnecting>()
        val connectedStates = mutableListOf<PostboxStateStreamStatus.Connected>()

        val malformedCollection = launch {
            stream.states
                .filterIsInstance<PostboxStateStreamStatus.Reconnecting>()
                .filter { it.reason.startsWith("Malformed state event") }
                .take(1)
                .toList(malformedStatuses)
        }
        val connectedCollection = launch {
            stream.states
                .filterIsInstance<PostboxStateStreamStatus.Connected>()
                .take(1)
                .toList(connectedStates)
        }

        try {
            stream.start()
            withTimeout(2.seconds) {
                malformedCollection.join()
                connectedCollection.join()
            }

            val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected SSE state request")
            assertEquals("/api/state/events", request.path)
            assertEquals(null, malformedStatuses.single().latestState)
            assertEquals("ask-after-malformed", connectedStates.single().latestState.requests.single().requestId)
        } finally {
            stream.close()
        }
    }

    @Test
    fun concurrentStartCallsAreIdempotentAndDoNotBlockCallers() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setBodyDelay(2, TimeUnit.SECONDS)
                .setBody("event: state\ndata: ${compactJson(representativeStateJson())}\n\n")
        )
        val stream = OkHttpPostboxStateStream(
            baseUrl = server.url("/").toString(),
            reconnectDelayMs = 60_000L
        )
        val threadCount = 8
        val executor = Executors.newFixedThreadPool(threadCount)
        val startGate = CountDownLatch(1)
        val doneGate = CountDownLatch(threadCount)

        try {
            repeat(threadCount) {
                executor.execute {
                    startGate.await()
                    stream.start()
                    doneGate.countDown()
                }
            }

            val elapsedMs = measureTimeMillis {
                startGate.countDown()
                assertTrue("start() calls should return promptly", doneGate.await(300, TimeUnit.MILLISECONDS))
            }
            assertTrue("start() should not wait for the first SSE status; elapsed=${elapsedMs}ms", elapsedMs < 300)

            val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected a single SSE state request")
            assertEquals("/api/state/events", request.path)
            delay(100)
            assertEquals("concurrent start() calls should share one SSE loop", null, server.takeRequest(200, TimeUnit.MILLISECONDS))
        } finally {
            executor.shutdownNow()
            stream.close()
        }
    }

    @Test
    fun stateStreamExposesReconnectOrErrorStateWhenSseConnectionFails() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(503)
                .setHeader("Content-Type", "text/plain; charset=utf-8")
                .setBody("maintenance")
        )
        val stream = OkHttpPostboxStateStream(baseUrl = server.url("/").toString())

        try {
            stream.start()
            val failedStatus = withTimeout(2.seconds) {
                stream.states.first {
                    it is PostboxStateStreamStatus.Reconnecting || it is PostboxStateStreamStatus.Disconnected
                }
            }

            val request = server.takeRequest(1, TimeUnit.SECONDS) ?: error("Expected SSE state request")
            assertEquals("/api/state/events", request.path)
            when (failedStatus) {
                is PostboxStateStreamStatus.Reconnecting -> {
                    assertEquals(null, failedStatus.latestState)
                    assertTrue(failedStatus.reason.contains("503"))
                }
                is PostboxStateStreamStatus.Disconnected -> assertTrue(failedStatus.reason.contains("503"))
                else -> fail("Expected reconnecting or disconnected state, got $failedStatus")
            }
        } finally {
            stream.close()
        }
    }

    private fun sseResponse(vararg states: String): MockResponse {
        val body = states.joinToString(separator = "") { state ->
            "event: state\ndata: ${compactJson(state)}\n\n"
        }
        return MockResponse()
            .setResponseCode(200)
            .setHeader("Content-Type", "text/event-stream; charset=utf-8")
            .setHeader("Cache-Control", "no-cache")
            .setBody(body)
    }
}

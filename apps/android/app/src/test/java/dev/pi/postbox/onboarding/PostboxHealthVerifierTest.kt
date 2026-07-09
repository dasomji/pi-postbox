package dev.pi.postbox.onboarding

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PostboxHealthVerifierTest {
    @Test
    fun verifiesValidPostboxHealthAndIgnoresUnknownFields() {
        TestHealthServer(
            statusCode = 200,
            body = """
                {
                  "ok": true,
                  "service": "pi-postbox",
                  "version": "0.1.0",
                  "protocolVersion": "0.1.0",
                  "uptimeMs": 1234,
                  "timestamp": "2026-06-25T12:00:00.000Z",
                  "futureAndroidClientsShouldIgnoreThis": { "nested": true }
                }
            """.trimIndent()
        ).use { server ->
            val result = OkHttpPostboxHealthVerifier().verify(server.baseUrl)

            assertEquals(listOf("/healthz"), server.paths)
            assertTrue(result is HealthVerificationResult.Valid)
            val valid = result as HealthVerificationResult.Valid
            assertEquals(server.baseUrl, valid.baseUrl)
            assertEquals("pi-postbox", valid.service)
            assertEquals("0.1.0", valid.version)
            assertEquals("0.1.0", valid.protocolVersion)
        }
    }

    @Test
    fun rejectsHealthyJsonFromANonPostboxService() {
        TestHealthServer(
            statusCode = 200,
            body = """
                {
                  "ok": true,
                  "service": "other-service",
                  "version": "9.9.9",
                  "protocolVersion": "0.1.0",
                  "uptimeMs": 1,
                  "timestamp": "2026-06-25T12:00:00.000Z"
                }
            """.trimIndent()
        ).use { server ->
            val result = OkHttpPostboxHealthVerifier().verify(server.baseUrl)

            assertEquals(listOf("/healthz"), server.paths)
            assertTrue(result is HealthVerificationResult.Rejected)
            assertEquals(
                HealthRejectionReason.NON_POSTBOX_HEALTH,
                (result as HealthVerificationResult.Rejected).reason
            )
        }
    }

    @Test
    fun rejectsMalformedPostboxHealthJson() {
        TestHealthServer(
            statusCode = 200,
            body = """
                {
                  "ok": true,
                  "service": "pi-postbox"
                }
            """.trimIndent()
        ).use { server ->
            val result = OkHttpPostboxHealthVerifier().verify(server.baseUrl)

            assertTrue(result is HealthVerificationResult.Rejected)
            assertEquals(
                HealthRejectionReason.MALFORMED_HEALTH_RESPONSE,
                (result as HealthVerificationResult.Rejected).reason
            )
        }
    }

    @Test
    fun reportsUnreachableServersAsRetryableConnectionFailures() {
        val closedServer = TestHealthServer(statusCode = 200, body = "{}").also { it.close() }

        val result = OkHttpPostboxHealthVerifier().verify(closedServer.baseUrl)

        assertTrue(result is HealthVerificationResult.Unreachable)
    }

    private class TestHealthServer(
        private val statusCode: Int,
        private val body: String
    ) : AutoCloseable {
        private val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        private val requestedPaths = Collections.synchronizedList(mutableListOf<String>())
        private val worker = thread(start = true, name = "postbox-health-test-server") { serveOneRequest() }

        val baseUrl: String
            get() = "http://127.0.0.1:${socket.localPort}/"

        val paths: List<String>
            get() = requestedPaths.toList()

        private fun serveOneRequest() {
            try {
                socket.accept().use { client ->
                    val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
                    val requestLine = reader.readLine().orEmpty()
                    requestedPaths.add(requestLine.split(" ").getOrNull(1) ?: "")
                    while (!reader.readLine().isNullOrEmpty()) {
                        // Drain headers.
                    }

                    val bytes = body.toByteArray(Charsets.UTF_8)
                    val headers = buildString {
                        append("HTTP/1.1 $statusCode OK\r\n")
                        append("Content-Type: application/json\r\n")
                        append("Content-Length: ${bytes.size}\r\n")
                        append("Connection: close\r\n")
                        append("\r\n")
                    }.toByteArray(Charsets.UTF_8)

                    client.getOutputStream().use { output ->
                        output.write(headers)
                        output.write(bytes)
                    }
                }
            } catch (_: Exception) {
                // Closing the server before a request is expected in the unreachable test.
            }
        }

        override fun close() {
            socket.close()
            worker.join(1_000)
        }
    }
}

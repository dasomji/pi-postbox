package dev.pi.postbox.protocol

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolCompatibilityTest {
    private val gate = ProtocolCompatibilityGate(clock = { Instant.parse("2026-08-25T12:00:00Z") })

    @Test
    fun `matching envelope invokes typed decoder`() {
        var decoderCalled = false

        val decoded = gate.decodeVersioned(
            rawMessage = """{"protocolVersion":"${GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION}","value":7}""",
            source = ProtocolMessageSource.STATE_HTTP
        ) {
            decoderCalled = true
            7
        }

        assertEquals(7, decoded)
        assertTrue(decoderCalled)
    }

    @Test
    fun `foreign envelope is rejected before typed decoder`() {
        var decoderCalled = false

        val error = assertThrows(PostboxProtocolMismatchException::class.java) {
            gate.decodeVersioned("""{"protocolVersion":"0.0.1","secret":"do not retain"}""", ProtocolMessageSource.STATE_STREAM) {
                decoderCalled = true
                Unit
            }
        }

        assertFalse(decoderCalled)
        assertEquals(ProtocolMismatchReason.DIFFERENT_VERSION, error.mismatch.reason)
        assertEquals("0.0.1", error.mismatch.receivedVersion)
        assertEquals(ProtocolMessageSource.STATE_STREAM, error.mismatch.source)
        assertFalse(error.toString().contains("secret"))
        assertFalse(error.toString().contains("do not retain"))
    }

    @Test
    fun `missing version is rejected before typed decoder`() {
        var decoderCalled = false

        val error = assertThrows(PostboxProtocolMismatchException::class.java) {
            gate.decodeVersioned("""{"value":"not decoded"}""", ProtocolMessageSource.FCM) {
                decoderCalled = true
                Unit
            }
        }

        assertFalse(decoderCalled)
        assertEquals(ProtocolMismatchReason.MISSING_VERSION, error.mismatch.reason)
        assertEquals(null, error.mismatch.receivedVersion)
        assertEquals("missing", error.mismatch.receivedVersionLabel)
    }

    @Test
    fun `malformed version evidence is represented safely`() {
        val longVersion = "sensitive".repeat(30)

        val error = assertThrows(PostboxProtocolMismatchException::class.java) {
            gate.requireCompatible(longVersion, ProtocolMessageSource.QUESTION_CHAT_HTTP)
        }

        assertEquals(ProtocolMismatchReason.DIFFERENT_VERSION, error.mismatch.reason)
        assertTrue(error.mismatch.receivedVersionLabel.length <= 64)
        assertFalse(error.mismatch.receivedVersionLabel.contains(longVersion))
        assertEquals(Instant.parse("2026-08-25T12:00:00Z"), error.mismatch.observedAt)
    }
}

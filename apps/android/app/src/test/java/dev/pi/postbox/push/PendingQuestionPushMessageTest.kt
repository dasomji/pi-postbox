package dev.pi.postbox.push

import dev.pi.postbox.notification.NotificationTapTarget
import dev.pi.postbox.protocol.GeneratedPostboxProtocolContract
import dev.pi.postbox.protocol.ProtocolMismatchReason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingQuestionPushMessageTest {
    @Test
    fun `maps ask created data payload to a pending question notification`() {
        val notification = pendingQuestionNotificationFromPushData(
            mapOf(
                "protocolVersion" to GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION,
                "type" to "ask.created",
                "requestId" to "ask-1",
                "sessionId" to "session-1",
                "title" to "New Postbox question",
                "body" to "pi-postbox · Answer loop needs your input.",
                "projectName" to "pi-postbox",
                "sessionTitle" to "Answer loop"
            )
        )

        requireNotNull(notification)
        assertEquals("ask-1", notification.requestId)
        assertEquals("New Postbox question", notification.title)
        assertEquals("pi-postbox · Answer loop needs your input.", notification.message)
        assertEquals(NotificationTapTarget.OpenQuestion("ask-1"), notification.tapTarget)
    }

    @Test
    fun `falls back to default title and message when payload omits them`() {
        val notification = pendingQuestionNotificationFromPushData(
            mapOf(
                "protocolVersion" to GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION,
                "type" to "ask.created",
                "requestId" to "ask-2"
            )
        )

        requireNotNull(notification)
        assertEquals("New Postbox question", notification.title)
        assertEquals("A Postbox session needs your input.", notification.message)
    }

    @Test
    fun `foreign and missing push evidence is rejected without mapping question content`() {
        val foreign = decodePostboxPushData(
            mapOf("protocolVersion" to "0.0.1", "type" to "ask.created", "requestId" to "secret-request")
        ) as PostboxPushDecision.IncompatibleProtocol
        val missing = decodePostboxPushData(
            mapOf("type" to "ask.created", "requestId" to "secret-request")
        ) as PostboxPushDecision.IncompatibleProtocol

        assertEquals(ProtocolMismatchReason.DIFFERENT_VERSION, foreign.mismatch.reason)
        assertEquals(ProtocolMismatchReason.MISSING_VERSION, missing.mismatch.reason)
        assertEquals("0.0.1", foreign.mismatch.receivedVersion)
        org.junit.Assert.assertFalse(foreign.toString().contains("secret-request"))
    }

    @Test
    fun `ignores unknown message types`() {
        assertNull(
            pendingQuestionNotificationFromPushData(
                mapOf("type" to "ask.resolved", "requestId" to "ask-3")
            )
        )
    }

    @Test
    fun `ignores payloads without a usable requestId`() {
        assertNull(pendingQuestionNotificationFromPushData(mapOf("type" to "ask.created")))
        assertNull(pendingQuestionNotificationFromPushData(mapOf("type" to "ask.created", "requestId" to "  ")))
    }

    @Test
    fun `maps ask resolved data payload to the requestId to dismiss`() {
        assertEquals(
            "ask-4",
            resolvedQuestionRequestIdFromPushData(mapOf("type" to "ask.resolved", "requestId" to "ask-4"))
        )
    }

    @Test
    fun `resolved mapping ignores other message types and blank requestIds`() {
        assertNull(resolvedQuestionRequestIdFromPushData(mapOf("type" to "ask.created", "requestId" to "ask-5")))
        assertNull(resolvedQuestionRequestIdFromPushData(mapOf("type" to "ask.resolved")))
        assertNull(resolvedQuestionRequestIdFromPushData(mapOf("type" to "ask.resolved", "requestId" to "  ")))
    }
}

package dev.pi.postbox.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class PostboxProtocolDtoTest {
    @Test
    fun parsesRepresentativeStateSnapshotAndIgnoresUnknownFields() {
        val snapshot = PostboxProtocolJson.decodeStateSnapshot(representativeStateJson())

        assertEquals("2026-06-25T12:00:00.000Z", snapshot.timestamp)

        val session = snapshot.sessions.single()
        assertEquals("session-1", session.sessionId)
        assertEquals("Native Android protocol client", session.title)
        assertEquals("machine-1", session.machineId)
        assertEquals("Studio Mac", session.machineName)
        assertEquals("project-1", session.projectId)
        assertEquals("Postbox", session.projectName)
        assertEquals("pi-postbox", session.projectDetectedName)
        assertEquals("feature/native-android", session.branch)
        assertEquals(true, session.isDirty)
        assertEquals(SemanticState.BLOCKED, session.semanticState)
        assertEquals(PresenceState.LIVE, session.presence)
        assertEquals("sha256:test-icon", session.projectIcon?.hash)
        assertEquals("image/svg+xml", session.projectIcon?.mediaType)

        val request = snapshot.requests.single()
        assertEquals("ask-protocol-1", request.requestId)
        assertEquals("session-1", request.sessionId)
        assertEquals(AskMode.MULTI, request.mode)
        assertEquals(AskStatus.PENDING, request.status)
        assertEquals("Choose protocol client behavior", request.question.prompt)
        assertEquals("Defines the first public client boundary.", request.question.decisionImpact)
        assertEquals("kotlinx", request.options[0].value)
        assertEquals("Use Kotlin serialization", request.options[0].label)
        assertEquals("Fastify server with shared protocol schemas.", request.context?.codebaseContext)
        assertEquals("Route", request.context?.additionalInfo?.single()?.title)
        assertEquals("leaf-1", request.forkReference?.leafId)
    }

    @Test
    fun parsesAnsweredTerminalResultFields() {
        val snapshot = PostboxProtocolJson.decodeStateSnapshot(
            representativeStateJson(
                requestId = "ask-answered-1",
                requestStatus = "answered",
                resolvedAt = "2026-06-25T12:05:00.000Z",
                resultJson = """
                    {
                      "status": "answered",
                      "requestId": "ask-answered-1",
                      "selectedValues": ["kotlinx", "manual"],
                      "note": "Ship the native client first.",
                      "rationale": "It matches the shared protocol.",
                      "resolvedAt": "2026-06-25T12:05:00.000Z",
                      "futureResultField": "ignored"
                    }
                """.trimIndent()
            )
        )

        val request = snapshot.requests.single()
        assertEquals(AskStatus.ANSWERED, request.status)
        assertEquals("2026-06-25T12:05:00.000Z", request.resolvedAt)
        val result = request.result ?: error("Expected answered result")
        assertEquals(AskResultStatus.ANSWERED, result.status)
        assertEquals("ask-answered-1", result.requestId)
        assertEquals(listOf("kotlinx", "manual"), result.selectedValues)
        assertEquals("Ship the native client first.", result.note)
        assertEquals("It matches the shared protocol.", result.rationale)
        assertEquals("2026-06-25T12:05:00.000Z", result.resolvedAt)
    }

    @Test
    fun parsesUnavailableTerminalResultWithoutTreatingItAsRequestCardStatus() {
        val snapshot = PostboxProtocolJson.decodeStateSnapshot(
            representativeStateJson(
                requestId = "ask-unavailable-1",
                requestStatus = "expired",
                resolvedAt = "2026-06-25T12:06:00.000Z",
                resultJson = """
                    {
                      "status": "unavailable",
                      "requestId": "ask-unavailable-1",
                      "rationale": "Pi Postbox became unavailable before the request could be delivered.",
                      "resolvedAt": "2026-06-25T12:06:00.000Z"
                    }
                """.trimIndent()
            )
        )

        val request = snapshot.requests.single()
        assertEquals(AskStatus.EXPIRED, request.status)
        val result = request.result ?: error("Expected unavailable result")
        assertEquals(AskResultStatus.UNAVAILABLE, result.status)
        assertEquals("ask-unavailable-1", result.requestId)
        assertEquals("Pi Postbox became unavailable before the request could be delivered.", result.rationale)
        assertEquals("2026-06-25T12:06:00.000Z", result.resolvedAt)
    }
}

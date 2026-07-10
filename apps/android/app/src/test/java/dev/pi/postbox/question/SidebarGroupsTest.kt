package dev.pi.postbox.question

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SidebarGroupsTest {
    private val snapshotTimestamp = "2026-06-25T12:00:00.000Z"

    @Test
    fun hidesSessionsThatWentOfflineBeforeTheRecentWindow() {
        val groups = buildSidebarGroups(
            sessions = listOf(
                session("session-live", presence = "live"),
                session("session-stale", presence = "offline", disconnectedAt = "2026-06-25T11:40:00.000Z")
            ),
            questions = emptyList(),
            snapshotTimestamp = snapshotTimestamp
        )

        assertEquals(listOf("session-live"), groups.single().sessions.map { it.sessionId })
    }

    @Test
    fun keepsRecentlyDisconnectedSessionsVisible() {
        val groups = buildSidebarGroups(
            sessions = listOf(
                session("session-recent", presence = "offline", disconnectedAt = "2026-06-25T11:56:00.000Z")
            ),
            questions = emptyList(),
            snapshotTimestamp = snapshotTimestamp
        )

        assertEquals(listOf("session-recent"), groups.single().sessions.map { it.sessionId })
    }

    @Test
    fun hidesOfflineSessionsWithoutDisconnectTimestamp() {
        val groups = buildSidebarGroups(
            sessions = listOf(session("session-unknown", presence = "offline", disconnectedAt = null)),
            questions = emptyList(),
            snapshotTimestamp = snapshotTimestamp
        )

        assertTrue(groups.isEmpty())
    }

    @Test
    fun keepsQuestionsFromHiddenSessionsUnderOtherQuestions() {
        val groups = buildSidebarGroups(
            sessions = listOf(
                session("session-gone", presence = "offline", disconnectedAt = "2026-06-25T11:00:00.000Z")
            ),
            questions = listOf(question("ask-orphan", sessionId = "session-gone")),
            snapshotTimestamp = snapshotTimestamp
        )

        val orphanGroup = groups.single()
        assertEquals("Other questions", orphanGroup.projectName)
        assertEquals(listOf("ask-orphan"), orphanGroup.questions.map { it.requestId })
    }

    @Test
    fun keepsProjectsWithTheSameDisplayNameSeparateByStableId() {
        val groups = buildSidebarGroups(
            sessions = listOf(
                session("session-one", projectName = "Postbox", projectId = "project-one"),
                session("session-two", projectName = "Postbox", projectId = "project-two")
            ),
            questions = emptyList(),
            snapshotTimestamp = snapshotTimestamp
        )

        assertEquals(listOf("project-one", "project-two"), groups.map { it.projectId })
    }

    @Test
    fun aggregatesSessionDotsAfterTheThirdSession() {
        assertEquals(3, MAX_INDIVIDUAL_SESSION_DOTS)
    }

    @Test
    fun aggregateStatusPrioritizesBlockedThenWorking() {
        assertEquals(
            AggregateSessionStatus.BLOCKED,
            aggregateSessionStatus(
                listOf(
                    session("session-working", semanticState = "working"),
                    session("session-blocked", semanticState = "blocked"),
                    session("session-idle", semanticState = "idle"),
                    session("session-offline", semanticState = "working", presence = "offline")
                )
            )
        )
        assertEquals(
            AggregateSessionStatus.WORKING,
            aggregateSessionStatus(
                listOf(
                    session("session-working", semanticState = "working"),
                    session("session-idle", semanticState = "idle")
                )
            )
        )
    }

    @Test
    fun aggregateStatusFallsBackToIdleThenOffline() {
        assertEquals(
            AggregateSessionStatus.IDLE,
            aggregateSessionStatus(listOf(session("session-idle", semanticState = "idle")))
        )
        assertEquals(
            AggregateSessionStatus.OFFLINE,
            aggregateSessionStatus(
                listOf(session("session-offline", semanticState = "blocked", presence = "offline"))
            )
        )
    }

    @Test
    fun sortsProjectsByNameAndQuestionsByCreationTime() {
        val groups = buildSidebarGroups(
            sessions = listOf(
                session("session-z", projectName = "Zeppelin"),
                session("session-a", projectName = "Airmail")
            ),
            questions = listOf(
                question("ask-later", sessionId = "session-a", createdAt = "2026-06-25T11:59:00.000Z"),
                question("ask-earlier", sessionId = "session-a", createdAt = "2026-06-25T11:30:00.000Z")
            ),
            snapshotTimestamp = snapshotTimestamp
        )

        assertEquals(listOf("Airmail", "Zeppelin"), groups.map { it.projectName })
        assertEquals(listOf("ask-earlier", "ask-later"), groups.first().questions.map { it.requestId })
    }

    private fun session(
        sessionId: String,
        projectName: String = "Postbox",
        projectId: String = projectName,
        semanticState: String = "idle",
        presence: String = "live",
        disconnectedAt: String? = null
    ): QuestionSessionUiState = QuestionSessionUiState(
        sessionId = sessionId,
        title = "Session $sessionId",
        projectName = projectName,
        machineName = "Studio Mac",
        semanticState = semanticState,
        presence = presence,
        branch = "feature/$sessionId",
        disconnectedAt = disconnectedAt,
        projectId = projectId
    )

    private fun question(
        requestId: String,
        sessionId: String,
        createdAt: String = "2026-06-25T11:59:00.000Z"
    ): QuestionListItemUiState = QuestionListItemUiState(
        requestId = requestId,
        sessionId = sessionId,
        prompt = "Prompt for $requestId",
        mode = QuestionMode.SINGLE,
        createdAt = createdAt,
        expiresAt = null
    )
}

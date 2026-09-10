package dev.pi.postbox.question

import org.junit.Assert.assertEquals
import org.junit.Test

class QuestionHeaderTest {
    private fun session(id: String, project: String, repo: String) = QuestionSessionUiState(
        sessionId = id, title = null, projectId = project, projectName = "Project $project", machineName = "host",
        semanticState = "idle", presence = "live", branch = "branch-$id", repositoryId = repo)
    private fun question(id: String, session: String, repo: String) = QuestionListItemUiState(
        requestId = id, sessionId = session, prompt = "Choose", mode = QuestionMode.SINGLE,
        createdAt = "2026-09-10T00:00:00Z", expiresAt = null, repositoryId = repo)
    private val state = QuestionWorkflowState(baseUrl = "http://localhost", sessions = listOf(
        session("a", "one", "repo-1"), session("b", "two", "repo-1"), session("c", "three", "repo-2")),
        pendingQuestions = listOf(question("q1", "a", "repo-1"), question("q2", "b", "repo-1"),
            question("q3", "c", "repo-2"), question("q4", "removed-session", "repo-1")))

    @Test fun countsTheRepositoryAcrossBranchesIncludingQuestionsWhoseSessionIsGone() {
        assertEquals(QuestionHeader("Project one", "branch-a", 3),
            questionHeader(state.copy(navigationSelection = QuestionNavigationSelection.Question("q1"))))
        assertEquals(QuestionHeader("Project three", "branch-c", 1),
            questionHeader(state.copy(navigationSelection = QuestionNavigationSelection.Question("q3"))))
    }
    @Test fun handlesProjectAndGlobalNavigationWithoutReusingThePreviousQuestion() {
        assertEquals(QuestionHeader("Project two", null, 3),
            questionHeader(state.copy(navigationSelection = QuestionNavigationSelection.Project("two"))))
        assertEquals(QuestionHeader("Pi Postbox", null, 0),
            questionHeader(state.copy(navigationSelection = QuestionNavigationSelection.Queue)))
    }
    @Test fun fallsBackToProjectIdentityForOlderSessions() {
        val legacy = state.copy(sessions = state.sessions.map { it.copy(repositoryId = null) },
            navigationSelection = QuestionNavigationSelection.Session("b"))
        assertEquals(QuestionHeader("Project two", "branch-b", 1), questionHeader(legacy))
    }
}

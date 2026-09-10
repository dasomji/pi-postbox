package dev.pi.postbox.question

internal data class QuestionHeader(val projectName: String, val branch: String?, val repositoryCount: Int)

internal fun questionHeader(state: QuestionWorkflowState): QuestionHeader {
    val sessionId = when (val selection = state.navigationSelection) {
        is QuestionNavigationSelection.Question -> state.visibleQuestion?.takeIf { it.requestId == selection.requestId }?.sessionId
            ?: state.pendingQuestions.find { it.requestId == selection.requestId }?.sessionId
        is QuestionNavigationSelection.Session -> selection.sessionId
        else -> null
    }
    val session = state.sessions.find { it.sessionId == sessionId }
    val projectId = (state.navigationSelection as? QuestionNavigationSelection.Project)?.projectId ?: session?.projectId
    val projectSession = session ?: state.sessions.find { it.projectId == projectId }
    val repositoryId = projectSession?.repositoryId
    val repositorySessions = state.sessions.filter {
        if (repositoryId != null) it.repositoryId == repositoryId else projectId != null && it.projectId == projectId
    }.mapTo(mutableSetOf()) { it.sessionId }
    val count = state.pendingQuestions.count {
        (repositoryId != null && it.repositoryId == repositoryId) || it.sessionId in repositorySessions
    }
    return QuestionHeader(
        projectName = projectSession?.projectName ?: if (projectId != null || sessionId != null) "Unknown project" else "Pi Postbox",
        branch = session?.branch,
        repositoryCount = count
    )
}

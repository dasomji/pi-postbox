package dev.pi.postbox.question

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

@Composable
fun QuestionWorkflowScreen(
    state: QuestionWorkflowState,
    onSelectQuestion: (String) -> Unit,
    onToggleOption: (String) -> Unit,
    onSubmitAnswer: (note: String?, rationale: String?) -> Unit,
    onCancelQuestion: (note: String?, rationale: String?) -> Unit,
    onEditServerUrl: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        WorkflowHeader(
            state = state,
            onEditServerUrl = onEditServerUrl
        )

        state.terminalMessage?.let { message ->
            MessageCard(
                title = "Question resolved",
                body = message.message
            )
        }
        state.errorMessage?.let { error ->
            MessageCard(
                title = "Unable to load questions",
                body = error
            )
        }

        if (state.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("Loading Postbox questions…")
            }
        } else {
            QuestionWorkflowContent(
                state = state,
                onSelectQuestion = onSelectQuestion,
                onToggleOption = onToggleOption,
                onSubmitAnswer = onSubmitAnswer,
                onCancelQuestion = onCancelQuestion,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun WorkflowHeader(
    state: QuestionWorkflowState,
    onEditServerUrl: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Pi Postbox",
                    style = MaterialTheme.typography.headlineSmall
                )
                Text(
                    text = state.baseUrl,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            OutlinedButton(onClick = onEditServerUrl) {
                Text("Edit server URL")
            }
        }
        val connectionText = when (state.connectionState) {
            QuestionConnectionState.CONNECTING -> "Connecting"
            QuestionConnectionState.CONNECTED -> "Connected"
            QuestionConnectionState.DISCONNECTED -> "Disconnected"
            QuestionConnectionState.ERROR -> "Error"
        }
        Text(
            text = state.connectionMessage?.let { "$connectionText: $it" } ?: connectionText,
            style = MaterialTheme.typography.bodySmall,
            color = if (state.connectionState == QuestionConnectionState.CONNECTED) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.error
            }
        )
        state.notificationStatusMessage?.let { statusMessage ->
            Text(
                text = statusMessage,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun QuestionWorkflowContent(
    state: QuestionWorkflowState,
    onSelectQuestion: (String) -> Unit,
    onToggleOption: (String) -> Unit,
    onSubmitAnswer: (note: String?, rationale: String?) -> Unit,
    onCancelQuestion: (note: String?, rationale: String?) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        SessionsAndQuestionsList(
            sessions = state.sessions,
            questions = state.pendingQuestions,
            visibleQuestionId = state.visibleQuestion?.requestId,
            onSelectQuestion = onSelectQuestion,
            modifier = Modifier.fillMaxWidth()
        )

        HorizontalDivider()

        val visibleQuestion = state.visibleQuestion
        if (visibleQuestion == null) {
            EmptyQuestionsCard()
        } else {
            QuestionDetailCard(
                question = visibleQuestion,
                onToggleOption = onToggleOption,
                onSubmitAnswer = onSubmitAnswer,
                onCancelQuestion = onCancelQuestion,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun SessionsAndQuestionsList(
    sessions: List<QuestionSessionUiState>,
    questions: List<QuestionListItemUiState>,
    visibleQuestionId: String?,
    onSelectQuestion: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Sessions (${sessions.size})",
                style = MaterialTheme.typography.titleMedium
            )
            if (sessions.isEmpty()) {
                Text("No active sessions reported by this server.")
            } else {
                sessions.take(3).forEach { session ->
                    Text(
                        text = listOfNotNull(
                            session.title ?: session.projectName,
                            session.machineName,
                            session.presence
                        ).joinToString(" • "),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            HorizontalDivider()
            Text(
                text = "Open questions (${questions.size})",
                style = MaterialTheme.typography.titleMedium
            )
            if (questions.isEmpty()) {
                Text("No pending questions.")
            } else {
                LazyColumn(
                    modifier = Modifier.height(148.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(questions, key = { it.requestId }) { question ->
                        QuestionListItem(
                            question = question,
                            selected = question.requestId == visibleQuestionId,
                            onClick = { onSelectQuestion(question.requestId) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestionListItem(
    question: QuestionListItemUiState,
    selected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = question.prompt,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "${question.mode.name.lowercase()} • ${question.sessionId}",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun QuestionDetailCard(
    question: QuestionDetailUiState,
    onToggleOption: (String) -> Unit,
    onSubmitAnswer: (note: String?, rationale: String?) -> Unit,
    onCancelQuestion: (note: String?, rationale: String?) -> Unit,
    modifier: Modifier = Modifier
) {
    var note by remember(question.requestId) { mutableStateOf("") }
    var rationale by remember(question.requestId) { mutableStateOf("") }
    val actionsEnabled = question.terminalState == null && !question.isSubmitting

    Card(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = question.prompt,
                    style = MaterialTheme.typography.titleLarge
                )
                question.terminalState?.let { terminalState ->
                    MessageCard(
                        title = "Terminal state",
                        body = terminalState.name.lowercase().replace('_', ' ')
                    )
                }
                QuestionTextSection("Question context", question.questionContext)
                QuestionTextSection("Relevance", question.relevance)
                QuestionTextSection("Decision impact", question.decisionImpact)
                QuestionTextSection("Problem context", question.handoffContext?.problemContext)
                QuestionTextSection("Codebase context", question.handoffContext?.codebaseContext)
                question.handoffContext?.additionalInfo.orEmpty().forEach { item ->
                    QuestionTextSection(item.title ?: item.kind, item.content)
                }

                Text(
                    text = if (question.mode == QuestionMode.SINGLE) "Choose one option" else "Choose one or more options",
                    style = MaterialTheme.typography.titleMedium
                )
                question.options.forEach { option ->
                    OptionRow(
                        mode = question.mode,
                        option = option,
                        selected = question.selectedValues.contains(option.value),
                        enabled = actionsEnabled,
                        onToggle = { onToggleOption(option.value) }
                    )
                }

                OutlinedTextField(
                    modifier = Modifier.fillMaxWidth(),
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Note (optional)") },
                    enabled = actionsEnabled,
                    minLines = 1
                )
                OutlinedTextField(
                    modifier = Modifier.fillMaxWidth(),
                    value = rationale,
                    onValueChange = { rationale = it },
                    label = { Text("Rationale (optional)") },
                    enabled = actionsEnabled,
                    minLines = 1
                )
                question.submissionError?.let { error ->
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            HorizontalDivider()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    enabled = actionsEnabled && question.availableActions.contains(QuestionAction.CANCEL),
                    onClick = { onCancelQuestion(note.nullIfBlank(), rationale.nullIfBlank()) }
                ) {
                    Text("Cancel")
                }
                Button(
                    enabled = actionsEnabled && question.canSubmit,
                    onClick = { onSubmitAnswer(note.nullIfBlank(), rationale.nullIfBlank()) }
                ) {
                    Text(if (question.isSubmitting) "Submitting…" else "Submit")
                }
            }
        }
    }
}

@Composable
private fun QuestionTextSection(title: String, body: String?) {
    if (body.isNullOrBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
private fun OptionRow(
    mode: QuestionMode,
    option: QuestionOptionUiState,
    selected: Boolean,
    enabled: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onToggle)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top
    ) {
        if (mode == QuestionMode.SINGLE) {
            RadioButton(
                selected = selected,
                enabled = enabled,
                onClick = onToggle
            )
        } else {
            Checkbox(
                checked = selected,
                enabled = enabled,
                onCheckedChange = { onToggle() }
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Column {
            Text(
                text = option.label,
                style = MaterialTheme.typography.bodyLarge
            )
            option.description?.let { description ->
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun EmptyQuestionsCard() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "All caught up",
                style = MaterialTheme.typography.titleMedium
            )
            Text("There are no pending Postbox questions right now.")
        }
    }
}

@Composable
private fun MessageCard(title: String, body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

private fun String.nullIfBlank(): String? = trim().ifBlank { null }

@Preview(showBackground = true)
@Composable
private fun QuestionWorkflowScreenPreview() {
    MaterialTheme {
        QuestionWorkflowScreen(
            state = QuestionWorkflowState(
                baseUrl = "https://postbox.tailnet.example:32187/",
                isLoading = false,
                connectionState = QuestionConnectionState.CONNECTED,
                sessions = listOf(
                    QuestionSessionUiState(
                        sessionId = "session-live",
                        title = "Native Android UI",
                        projectName = "Postbox",
                        machineName = "Pixel",
                        semanticState = "blocked",
                        presence = "live",
                        branch = "feature/native-question-ui"
                    )
                ),
                pendingQuestions = listOf(
                    QuestionListItemUiState(
                        requestId = "ask-single",
                        sessionId = "session-live",
                        prompt = "Choose one deployment target",
                        mode = QuestionMode.SINGLE,
                        createdAt = "now",
                        expiresAt = null
                    )
                ),
                visibleQuestion = QuestionDetailUiState(
                    requestId = "ask-single",
                    sessionId = "session-live",
                    mode = QuestionMode.SINGLE,
                    prompt = "Choose one deployment target",
                    questionContext = "The verified server URL belongs to the developer Tailnet.",
                    relevance = "The Android client should guide the developer to a reachable endpoint.",
                    decisionImpact = "The selected target controls which server receives the answer.",
                    options = listOf(
                        QuestionOptionUiState("tailnet", "Use Tailnet HTTPS", "Connect to the verified HTTPS URL."),
                        QuestionOptionUiState("loopback", "Use emulator loopback", "Connect to 10.0.2.2.")
                    ),
                    handoffContext = null,
                    forkReference = null,
                    availableActions = listOf(QuestionAction.SUBMIT, QuestionAction.CANCEL)
                )
            ),
            onSelectQuestion = {},
            onToggleOption = {},
            onSubmitAnswer = { _, _ -> },
            onCancelQuestion = { _, _ -> },
            onEditServerUrl = {}
        )
    }
}

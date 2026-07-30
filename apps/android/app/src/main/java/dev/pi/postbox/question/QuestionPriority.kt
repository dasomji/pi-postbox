package dev.pi.postbox.question

import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskUrgency
import java.time.Instant
import java.time.OffsetDateTime

internal val askRequestPriorityComparator: Comparator<AskRequestSnapshot> =
    compareBy<AskRequestSnapshot> { it.urgency.priorityRank }
        .thenBy { parseQuestionInstant(it.createdAt) ?: Instant.MAX }
        .thenBy { it.requestId }

internal val questionListPriorityComparator: Comparator<QuestionListItemUiState> =
    compareBy<QuestionListItemUiState> { it.urgency.priorityRank }
        .thenBy { parseQuestionInstant(it.createdAt) ?: Instant.MAX }
        .thenBy { it.requestId }

internal fun parseQuestionInstant(timestamp: String): Instant? =
    runCatching { Instant.parse(timestamp) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(timestamp).toInstant() }.getOrNull()

private val AskUrgency.priorityRank: Int
    get() = when (this) {
        AskUrgency.HIGH -> 0
        AskUrgency.NORMAL -> 1
        AskUrgency.LOW -> 2
    }

private val QuestionUrgency.priorityRank: Int
    get() = when (this) {
        QuestionUrgency.HIGH -> 0
        QuestionUrgency.NORMAL -> 1
        QuestionUrgency.LOW -> 2
    }

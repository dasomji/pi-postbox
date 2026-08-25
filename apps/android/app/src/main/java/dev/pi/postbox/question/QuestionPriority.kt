package dev.pi.postbox.question

import dev.pi.postbox.protocol.AskRequestSnapshot
import java.time.Instant
import java.time.OffsetDateTime

internal val askRequestPriorityComparator: Comparator<AskRequestSnapshot> =
    compareBy<AskRequestSnapshot> { parseQuestionInstant(it.createdAt) ?: Instant.MAX }
        .thenBy { it.requestId }

internal val questionListPriorityComparator: Comparator<QuestionListItemUiState> =
    compareBy<QuestionListItemUiState> { parseQuestionInstant(it.createdAt) ?: Instant.MAX }
        .thenBy { it.requestId }

internal fun parseQuestionInstant(timestamp: String): Instant? =
    runCatching { Instant.parse(timestamp) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(timestamp).toInstant() }.getOrNull()

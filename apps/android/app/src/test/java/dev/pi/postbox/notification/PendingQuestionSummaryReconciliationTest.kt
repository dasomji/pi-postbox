package dev.pi.postbox.notification

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingQuestionSummaryReconciliationTest {
    @Test
    fun `resolved push decrements summary even when opened child notification is gone`() {
        assertEquals(
            PendingSummaryResolution(2, setOf("ask-resolved")),
            pendingSummaryAfterResolvedPush(
                summaryCount = 3,
                activePendingNotificationIds = setOf("ask-resolved".hashCode()),
                resolvedNotificationId = "ask-resolved".hashCode(),
                resolvedRequestId = "ask-resolved",
                alreadyResolvedRequestIds = emptySet()
            )
        )
    }

    @Test
    fun `resolved push falls back to remaining child notifications without a summary`() {
        assertEquals(
            PendingSummaryResolution(1, setOf("ask-resolved")),
            pendingSummaryAfterResolvedPush(
                summaryCount = null,
                activePendingNotificationIds = setOf("ask-resolved".hashCode(), "ask-pending".hashCode()),
                resolvedNotificationId = "ask-resolved".hashCode(),
                resolvedRequestId = "ask-resolved",
                alreadyResolvedRequestIds = emptySet()
            )
        )
    }

    @Test
    fun `duplicate resolved push does not decrement fallback summary twice`() {
        val first = pendingSummaryAfterResolvedPush(
            summaryCount = 3,
            activePendingNotificationIds = emptySet(),
            resolvedNotificationId = "ask-resolved".hashCode(),
            resolvedRequestId = "ask-resolved",
            alreadyResolvedRequestIds = emptySet()
        )

        assertEquals(
            PendingSummaryResolution(2, setOf("ask-resolved")),
            pendingSummaryAfterResolvedPush(
                summaryCount = first.pendingCount,
                activePendingNotificationIds = emptySet(),
                resolvedNotificationId = "ask-resolved".hashCode(),
                resolvedRequestId = "ask-resolved",
                alreadyResolvedRequestIds = first.resolvedRequestIds
            )
        )
    }
}

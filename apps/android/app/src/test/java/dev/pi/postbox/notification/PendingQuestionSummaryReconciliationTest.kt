package dev.pi.postbox.notification

import org.junit.Assert.assertEquals
import org.junit.Test

class PendingQuestionSummaryReconciliationTest {
    @Test
    fun `resolved push decrements summary even when opened child notification is gone`() {
        assertEquals(
            2,
            pendingCountAfterResolvedPush(
                summaryCount = 3,
                activePendingNotificationIds = setOf("ask-resolved".hashCode()),
                resolvedNotificationId = "ask-resolved".hashCode()
            )
        )
    }

    @Test
    fun `resolved push falls back to remaining child notifications without a summary`() {
        assertEquals(
            1,
            pendingCountAfterResolvedPush(
                summaryCount = null,
                activePendingNotificationIds = setOf("ask-resolved".hashCode(), "ask-pending".hashCode()),
                resolvedNotificationId = "ask-resolved".hashCode()
            )
        )
    }
}

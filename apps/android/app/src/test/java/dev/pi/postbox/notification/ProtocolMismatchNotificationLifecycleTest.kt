package dev.pi.postbox.notification

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolMismatchNotificationLifecycleTest {
    @Test
    fun `pending reconciliation preserves fixed deduplicated mismatch notification`() {
        assertFalse(
            shouldCancelDuringPendingReconciliation(
                channelId = AndroidPendingQuestionNotifier.CHANNEL_ID,
                notificationId = AndroidPendingQuestionNotifier.PROTOCOL_MISMATCH_NOTIFICATION_ID,
                pendingNotificationIds = emptySet()
            )
        )
        assertTrue(
            shouldCancelDuringPendingReconciliation(
                channelId = AndroidPendingQuestionNotifier.CHANNEL_ID,
                notificationId = 42,
                pendingNotificationIds = emptySet()
            )
        )
    }
}

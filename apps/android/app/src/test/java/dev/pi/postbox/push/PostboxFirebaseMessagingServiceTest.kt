package dev.pi.postbox.push

import org.junit.Assert.assertEquals
import org.junit.Test

class PostboxFirebaseMessagingServiceTest {
    @Test
    fun resolvedPushCancelsQuestionAndReconcilesSummaryFromCacheWhenOffline() {
        val cancelled = mutableListOf<String>()
        val reconciled = mutableListOf<Set<String>>()

        reconcileResolvedPushLocally(
            requestId = "ask-resolved",
            baseUrl = "https://postbox.example/",
            cancel = { requestId: String -> cancelled.add(requestId) },
            resolveCachedPendingIds = { _: String, _: String -> setOf("ask-still-pending") },
            reconcilePendingIds = { pendingIds: Set<String> -> reconciled.add(pendingIds) }
        )

        assertEquals(listOf("ask-resolved"), cancelled)
        assertEquals(listOf(setOf("ask-still-pending")), reconciled)
    }

    @Test
    fun resolvedPushDismissesSummaryWhenCachedPendingCountReachesZero() {
        val reconciled = mutableListOf<Set<String>>()

        reconcileResolvedPushLocally(
            requestId = "ask-last",
            baseUrl = "https://postbox.example/",
            cancel = {},
            resolveCachedPendingIds = { _: String, _: String -> emptySet() },
            reconcilePendingIds = { pendingIds: Set<String> -> reconciled.add(pendingIds) }
        )

        assertEquals(listOf(emptySet<String>()), reconciled)
    }
}

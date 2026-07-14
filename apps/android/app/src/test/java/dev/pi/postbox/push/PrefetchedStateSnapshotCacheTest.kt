package dev.pi.postbox.push

import dev.pi.postbox.question.questionWorkflowState
import org.junit.After
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test

class PrefetchedStateSnapshotCacheTest {
    @Before
    fun clearCache() {
        PrefetchedStateSnapshotCache.clear()
    }

    @After
    fun clearCacheAfter() {
        PrefetchedStateSnapshotCache.clear()
    }

    @Test
    fun `returns the stored snapshot for the same base url while fresh`() {
        val snapshot = questionWorkflowState()
        PrefetchedStateSnapshotCache.store("http://coolify:32187", snapshot, nowMillis = 1_000)

        assertSame(snapshot, PrefetchedStateSnapshotCache.freshSnapshotFor("http://coolify:32187", nowMillis = 30_000))
    }

    @Test
    fun `ignores snapshots stored for another server`() {
        PrefetchedStateSnapshotCache.store("http://coolify:32187", questionWorkflowState(), nowMillis = 1_000)

        assertNull(PrefetchedStateSnapshotCache.freshSnapshotFor("http://other:32187", nowMillis = 2_000))
    }

    @Test
    fun `ignores snapshots older than the freshness window`() {
        PrefetchedStateSnapshotCache.store("http://coolify:32187", questionWorkflowState(), nowMillis = 1_000)

        assertNull(
            PrefetchedStateSnapshotCache.freshSnapshotFor(
                "http://coolify:32187",
                nowMillis = 1_000 + PrefetchedStateSnapshotCache.DEFAULT_MAX_AGE_MILLIS + 1
            )
        )
    }

    @Test
    fun `returns nothing after the cache is cleared`() {
        PrefetchedStateSnapshotCache.store("http://coolify:32187", questionWorkflowState(), nowMillis = 1_000)
        PrefetchedStateSnapshotCache.clear()

        assertNull(PrefetchedStateSnapshotCache.freshSnapshotFor("http://coolify:32187", nowMillis = 2_000))
    }
}

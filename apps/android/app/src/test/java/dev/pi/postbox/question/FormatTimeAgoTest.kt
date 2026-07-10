package dev.pi.postbox.question

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTimeAgoTest {
    private val now: Instant = Instant.parse("2026-07-09T12:00:00Z")

    @Test
    fun `reports just now under a minute`() {
        assertEquals("just now", formatTimeAgo("2026-07-09T11:59:30Z", now))
    }

    @Test
    fun `reports minutes then hours then days`() {
        assertEquals("5 min ago", formatTimeAgo("2026-07-09T11:55:00Z", now))
        assertEquals("3 h ago", formatTimeAgo("2026-07-09T09:00:00Z", now))
        assertEquals("1 day ago", formatTimeAgo("2026-07-08T11:00:00Z", now))
        assertEquals("2 days ago", formatTimeAgo("2026-07-07T09:00:00Z", now))
    }

    @Test
    fun `accepts offset timestamps`() {
        assertEquals("just now", formatTimeAgo("2026-07-09T14:00:00+02:00", now))
    }

    @Test
    fun `clamps future timestamps to just now`() {
        assertEquals("just now", formatTimeAgo("2026-07-09T12:10:00Z", now))
    }

    @Test
    fun `reports unknown for unparseable timestamps`() {
        assertEquals("unknown", formatTimeAgo("not-a-timestamp", now))
    }
}

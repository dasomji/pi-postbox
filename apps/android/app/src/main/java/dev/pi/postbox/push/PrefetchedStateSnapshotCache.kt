package dev.pi.postbox.push

import android.util.Log
import dev.pi.postbox.protocol.OkHttpPostboxProtocolClient
import dev.pi.postbox.protocol.PostboxProtocolClient
import dev.pi.postbox.protocol.StateSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Process-wide handoff of a state snapshot fetched while handling an FCM push, so the question
 * workflow renders current data immediately when the user opens the app from a notification
 * instead of showing the previous visit's stale queue while the first fetch is still in flight.
 */
object PrefetchedStateSnapshotCache {
    const val DEFAULT_MAX_AGE_MILLIS: Long = 2 * 60 * 1000L

    private data class Entry(val baseUrl: String, val snapshot: StateSnapshot, val fetchedAtMillis: Long)

    @Volatile
    private var entry: Entry? = null

    fun store(baseUrl: String, snapshot: StateSnapshot, nowMillis: Long = System.currentTimeMillis()) {
        entry = Entry(baseUrl = baseUrl, snapshot = snapshot, fetchedAtMillis = nowMillis)
    }

    fun freshSnapshotFor(
        baseUrl: String,
        maxAgeMillis: Long = DEFAULT_MAX_AGE_MILLIS,
        nowMillis: Long = System.currentTimeMillis()
    ): StateSnapshot? {
        val current = entry ?: return null
        if (current.baseUrl != baseUrl) return null
        if (nowMillis - current.fetchedAtMillis > maxAgeMillis) return null
        return current.snapshot
    }

    fun clear() {
        entry = null
    }
}

/**
 * Fetches the current state in the FCM message's execution window and stores it in
 * [PrefetchedStateSnapshotCache]. Best-effort: failures only log, the app falls back to its
 * normal fetch-on-open path.
 */
object PostboxStatePrefetch {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun prefetch(
        baseUrl: String,
        clientFactory: (String) -> PostboxProtocolClient = { OkHttpPostboxProtocolClient(it) },
        store: (String, StateSnapshot) -> Unit = { url, snapshot -> PrefetchedStateSnapshotCache.store(url, snapshot) }
    ) {
        scope.launch {
            runCatching { store(baseUrl, clientFactory(baseUrl).fetchState()) }
                .onFailure { error -> Log.w(TAG, "Unable to prefetch Postbox state after push.", error) }
        }
    }

    private const val TAG = "PostboxStatePrefetch"
}

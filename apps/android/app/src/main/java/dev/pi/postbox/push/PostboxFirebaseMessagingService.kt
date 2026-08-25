package dev.pi.postbox.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.pi.postbox.notification.AndroidPendingQuestionNotifier
import dev.pi.postbox.onboarding.SharedPreferencesVerifiedServerUrlStore
import dev.pi.postbox.protocol.AskStatus

/**
 * Receives server-sent FCM data messages for new pending Postbox questions and posts them through
 * the same notifier the in-app tracker uses. Notification IDs are derived from the requestId in
 * both paths, so a question observed by both never shows up twice.
 */
class PostboxFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val notifier = AndroidPendingQuestionNotifier(applicationContext)
        val decision = decodePostboxPushData(message.data)
        if (decision is PostboxPushDecision.IncompatibleProtocol) {
            ProtocolMismatchEvidenceStore(applicationContext).save(decision.mismatch)
            notifier.postProtocolMismatch(decision.mismatch)
            return
        }
        if (decision is PostboxPushDecision.Ignored) return

        val savedBaseUrl = SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl()
        if (decision is PostboxPushDecision.Resolved) {
            reconcileResolvedPushLocally(
                requestId = decision.requestId,
                baseUrl = savedBaseUrl,
                cancel = notifier::cancel,
                resolveCachedPendingIds = { baseUrl, requestId ->
                    PrefetchedStateSnapshotCache.resolvePendingQuestion(baseUrl, requestId)
                },
                reconcilePendingIds = notifier::reconcilePendingRequests
            )
        }

        // Fetch the fresh state now, in the push execution window, so both the cached queue and
        // launcher badge represent every pending Question even while the activity is closed.
        savedBaseUrl?.let { baseUrl ->
            PostboxStatePrefetch.prefetch(baseUrl) { url, snapshot ->
                PrefetchedStateSnapshotCache.store(url, snapshot)
                notifier.reconcilePendingRequests(
                    snapshot.requests
                        .filter { request -> request.status == AskStatus.PENDING }
                        .mapTo(hashSetOf()) { request -> request.requestId }
                )
            }
        }

        when (decision) {
            is PostboxPushDecision.Resolved -> Unit
            is PostboxPushDecision.Created -> notifier.post(decision.notification)
            is PostboxPushDecision.IncompatibleProtocol,
            PostboxPushDecision.Ignored -> Unit
        }
    }

    override fun onNewToken(token: String) {
        val baseUrl = SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl() ?: return
        PostboxFcmTokenRegistration.upload(baseUrl, token) { mismatch ->
            ProtocolMismatchEvidenceStore(applicationContext).save(mismatch)
            AndroidPendingQuestionNotifier(applicationContext).postProtocolMismatch(mismatch)
        }
    }
}

internal fun reconcileResolvedPushLocally(
    requestId: String,
    baseUrl: String?,
    cancel: (String) -> Unit,
    resolveCachedPendingIds: (String, String) -> Set<String>?,
    reconcilePendingIds: (Set<String>) -> Unit
) {
    cancel(requestId)
    val pendingIds = baseUrl?.let { resolveCachedPendingIds(it, requestId) } ?: return
    reconcilePendingIds(pendingIds)
}

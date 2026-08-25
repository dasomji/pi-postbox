package dev.pi.postbox.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.pi.postbox.notification.AndroidPendingQuestionNotifier
import dev.pi.postbox.onboarding.SharedPreferencesVerifiedServerUrlStore

/**
 * Receives server-sent FCM data messages for new pending Postbox questions and posts them through
 * the same notifier the in-app tracker uses. Notification IDs are derived from the requestId in
 * both paths, so a question observed by both never shows up twice.
 */
class PostboxFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val decision = decodePostboxPushData(message.data)
        if (decision is PostboxPushDecision.IncompatibleProtocol) {
            ProtocolMismatchEvidenceStore(applicationContext).save(decision.mismatch)
            AndroidPendingQuestionNotifier(applicationContext).postProtocolMismatch(decision.mismatch)
            return
        }
        if (decision is PostboxPushDecision.Ignored) return

        // Fetch the fresh state now, in the push execution window, so an app open in the next
        // couple of minutes renders the current queue immediately instead of stale data.
        SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl()?.let { baseUrl ->
            PostboxStatePrefetch.prefetch(baseUrl)
        }

        when (decision) {
            is PostboxPushDecision.Resolved -> AndroidPendingQuestionNotifier(applicationContext).cancel(decision.requestId)
            is PostboxPushDecision.Created -> AndroidPendingQuestionNotifier(applicationContext).post(decision.notification)
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

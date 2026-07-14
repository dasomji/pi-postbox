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
        val resolvedRequestId = resolvedQuestionRequestIdFromPushData(message.data)
        val notification = if (resolvedRequestId == null) pendingQuestionNotificationFromPushData(message.data) else null
        if (resolvedRequestId == null && notification == null) return

        // Fetch the fresh state now, in the push execution window, so an app open in the next
        // couple of minutes renders the current queue immediately instead of stale data.
        SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl()?.let { baseUrl ->
            PostboxStatePrefetch.prefetch(baseUrl)
        }

        if (resolvedRequestId != null) {
            AndroidPendingQuestionNotifier(applicationContext).cancel(resolvedRequestId)
            return
        }
        if (notification != null) {
            AndroidPendingQuestionNotifier(applicationContext).post(notification)
        }
    }

    override fun onNewToken(token: String) {
        val baseUrl = SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl() ?: return
        PostboxFcmTokenRegistration.upload(baseUrl, token)
    }
}

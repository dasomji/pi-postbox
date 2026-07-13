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
        val notification = pendingQuestionNotificationFromPushData(message.data) ?: return
        AndroidPendingQuestionNotifier(applicationContext).post(notification)
    }

    override fun onNewToken(token: String) {
        val baseUrl = SharedPreferencesVerifiedServerUrlStore(applicationContext).loadVerifiedServerUrl() ?: return
        PostboxFcmTokenRegistration.upload(baseUrl, token)
    }
}

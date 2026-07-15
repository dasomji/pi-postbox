package dev.pi.postbox.notification

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
import java.lang.SecurityException
import dev.pi.postbox.MainActivity
import dev.pi.postbox.R

class AndroidNotificationPermissionController(private val context: Context) {
    fun currentState(): NotificationPermissionState = policy().permissionState(permissionGranted = hasPostNotificationsPermission())

    fun shouldRequestRuntimePermission(): Boolean = policy().shouldRequestRuntimePermission(
        permissionGranted = hasPostNotificationsPermission()
    )

    private fun hasPostNotificationsPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun policy(): NotificationPermissionPolicy = NotificationPermissionPolicy(Build.VERSION.SDK_INT)
}

class AndroidPendingQuestionNotifier(
    private val context: Context,
    private val permissionController: AndroidNotificationPermissionController = AndroidNotificationPermissionController(context)
) {
    private val notificationManager: NotificationManager = context.getSystemService(NotificationManager::class.java)

    fun postAll(notifications: List<PendingQuestionNotification>) {
        notifications.forEach { notification -> post(notification) }
    }

    @SuppressLint("MissingPermission")
    fun post(notification: PendingQuestionNotification) {
        if (!permissionController.currentState().toAvailability().canPostNotifications) return

        ensureChannel()

        try {
            notificationManager.notify(
                notification.notificationId(),
                Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_postbox_notification)
                    .setContentTitle(notification.title)
                    .setContentText(PRIVATE_NOTIFICATION_TEXT)
                    .setStyle(Notification.BigTextStyle().bigText(PRIVATE_NOTIFICATION_TEXT))
                    .setContentIntent(notification.toPendingIntent())
                    .setAutoCancel(true)
                    .setShowWhen(true)
                    .build()
            )
        } catch (_: SecurityException) {
            // Permission can be revoked between the preflight check and notify(); keep the question workflow usable.
        }
    }

    fun cancel(requestId: String) {
        notificationManager.cancel(requestId.hashCode())
    }

    /** Cancel app-owned notifications whose questions are no longer in the pending snapshot. */
    fun reconcilePendingRequests(pendingRequestIds: Set<String>) {
        val pendingNotificationIds = pendingRequestIds.mapTo(hashSetOf()) { it.hashCode() }
        try {
            notificationManager.activeNotifications
                .filter { notification ->
                    notification.notification.channelId == CHANNEL_ID && notification.id !in pendingNotificationIds
                }
                .forEach { notification -> notificationManager.cancel(notification.id) }
        } catch (_: SecurityException) {
            // Notification access can change while the app is running; reconciliation is best-effort.
        }
    }

    private fun ensureChannel() {
        val existing = notificationManager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return

        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = CHANNEL_DESCRIPTION
            }
        )
    }

    private fun PendingQuestionNotification.toPendingIntent(): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = tapTarget.intentAction
            data = Uri.parse(tapTarget.toDeepLinkUri())
            putExtra(EXTRA_REQUEST_ID, requestId)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }

        return PendingIntent.getActivity(
            context,
            requestId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun PendingQuestionNotification.notificationId(): Int = requestId.hashCode()

    companion object {
        const val CHANNEL_ID: String = "pending-postbox-questions"
        const val CHANNEL_NAME: String = "Postbox questions"
        const val CHANNEL_DESCRIPTION: String = "Local notifications for newly observed pending Postbox questions while the app is active."
        const val PRIVATE_NOTIFICATION_TEXT: String = "Open Postbox to review and answer."
        const val EXTRA_REQUEST_ID: String = "dev.pi.postbox.extra.REQUEST_ID"
    }
}

fun Intent.postboxNotificationRequestId(): String? {
    if (action != NotificationTapTarget.ACTION_OPEN_QUESTION) return null
    return getStringExtra(AndroidPendingQuestionNotifier.EXTRA_REQUEST_ID)
        ?: data?.toString()?.let(NotificationTapTarget::requestIdFromDeepLinkUri)
}

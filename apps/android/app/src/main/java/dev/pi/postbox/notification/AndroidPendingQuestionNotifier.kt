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
import dev.pi.postbox.protocol.ProtocolMismatch

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
                    .setGroup(PENDING_QUESTIONS_GROUP_KEY)
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

    fun cancelProtocolMismatch() {
        notificationManager.cancel(PROTOCOL_MISMATCH_NOTIFICATION_ID)
    }

    @SuppressLint("MissingPermission")
    fun postProtocolMismatch(mismatch: ProtocolMismatch) {
        if (!permissionController.currentState().toAvailability().canPostNotifications) return
        ensureChannel()
        val intent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_OPEN_PROTOCOL_MISMATCH
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            PROTOCOL_MISMATCH_NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val safeText = "Supports ${mismatch.supportedVersion}; received ${mismatch.receivedVersionLabel}."
        try {
            notificationManager.notify(
                PROTOCOL_MISMATCH_NOTIFICATION_ID,
                Notification.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_postbox_notification)
                    .setContentTitle("Postbox update required")
                    .setContentText(safeText)
                    .setStyle(Notification.BigTextStyle().bigText(safeText))
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .build()
            )
        } catch (_: SecurityException) {
            // Notification permission can change between preflight and posting.
        }
    }

    /** Reconcile per-Question notifications and the launcher badge against the full pending queue. */
    fun reconcilePendingRequests(pendingRequestIds: Set<String>) {
        val pendingNotificationIds = pendingRequestIds.mapTo(hashSetOf()) { it.hashCode() }
        try {
            notificationManager.activeNotifications
                .filter { notification ->
                    shouldCancelDuringPendingReconciliation(
                        channelId = notification.notification.channelId,
                        notificationId = notification.id,
                        pendingNotificationIds = pendingNotificationIds
                    )
                }
                .forEach { notification -> notificationManager.cancel(notification.id) }
        } catch (_: SecurityException) {
            // Notification access can change while the app is running; reconciliation is best-effort.
        }
        reconcilePendingSummary(pendingRequestIds.size)
    }

    @SuppressLint("MissingPermission")
    private fun reconcilePendingSummary(pendingCount: Int) {
        if (pendingCount == 0) {
            notificationManager.cancel(PENDING_SUMMARY_NOTIFICATION_ID)
            return
        }
        if (!permissionController.currentState().toAvailability().canPostNotifications) return

        ensureSummaryChannel()
        val label = if (pendingCount == 1) "1 Postbox question waiting" else "$pendingCount Postbox questions waiting"
        try {
            notificationManager.notify(
                PENDING_SUMMARY_NOTIFICATION_ID,
                Notification.Builder(context, PENDING_SUMMARY_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_postbox_notification)
                    .setContentTitle(label)
                    .setContentText(PRIVATE_NOTIFICATION_TEXT)
                    .setStyle(Notification.BigTextStyle().bigText(PRIVATE_NOTIFICATION_TEXT))
                    .setContentIntent(pendingSummaryIntent())
                    .setGroup(PENDING_QUESTIONS_GROUP_KEY)
                    .setGroupSummary(true)
                    .setNumber(pendingCount)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setShowWhen(false)
                    .build()
            )
        } catch (_: SecurityException) {
            // Permission can be revoked between the preflight check and posting.
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
                setShowBadge(true)
            }
        )
    }

    private fun ensureSummaryChannel() {
        val existing = notificationManager.getNotificationChannel(PENDING_SUMMARY_CHANNEL_ID)
        if (existing != null) return

        notificationManager.createNotificationChannel(
            NotificationChannel(
                PENDING_SUMMARY_CHANNEL_ID,
                PENDING_SUMMARY_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = PENDING_SUMMARY_CHANNEL_DESCRIPTION
                setShowBadge(true)
            }
        )
    }

    private fun pendingSummaryIntent(): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            context,
            PENDING_SUMMARY_NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
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
        const val CHANNEL_DESCRIPTION: String = "Notifications for newly observed pending Postbox questions."
        const val PENDING_SUMMARY_CHANNEL_ID: String = "pending-postbox-question-count"
        const val PENDING_SUMMARY_CHANNEL_NAME: String = "Postbox question count"
        const val PENDING_SUMMARY_CHANNEL_DESCRIPTION: String = "Quiet pending-question total used for the launcher badge."
        const val PRIVATE_NOTIFICATION_TEXT: String = "Open Postbox to review and answer."
        const val EXTRA_REQUEST_ID: String = "dev.pi.postbox.extra.REQUEST_ID"
        const val ACTION_OPEN_PROTOCOL_MISMATCH: String = "dev.pi.postbox.OPEN_PROTOCOL_MISMATCH"
        const val PROTOCOL_MISMATCH_NOTIFICATION_ID: Int = 0x50524f54
        const val PENDING_SUMMARY_NOTIFICATION_ID: Int = 0x50424f58
        const val PENDING_QUESTIONS_GROUP_KEY: String = "dev.pi.postbox.PENDING_QUESTIONS"
    }
}

internal fun shouldCancelDuringPendingReconciliation(
    channelId: String?,
    notificationId: Int,
    pendingNotificationIds: Set<Int>
): Boolean = channelId == AndroidPendingQuestionNotifier.CHANNEL_ID &&
    notificationId != AndroidPendingQuestionNotifier.PROTOCOL_MISMATCH_NOTIFICATION_ID &&
    notificationId != AndroidPendingQuestionNotifier.PENDING_SUMMARY_NOTIFICATION_ID &&
    notificationId !in pendingNotificationIds

fun Intent.postboxNotificationRequestId(): String? {
    if (action != NotificationTapTarget.ACTION_OPEN_QUESTION) return null
    return getStringExtra(AndroidPendingQuestionNotifier.EXTRA_REQUEST_ID)
        ?: data?.toString()?.let(NotificationTapTarget::requestIdFromDeepLinkUri)
}

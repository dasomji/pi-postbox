package dev.pi.postbox.push

import dev.pi.postbox.notification.NotificationTapTargetFactory
import dev.pi.postbox.notification.PendingQuestionNotification

/**
 * Maps the data payload of a server-sent FCM message to the same notification event the in-app
 * tracker produces, so foreground-observed and push-delivered questions share one notification path.
 * Returns null for payloads this app version does not understand.
 */
fun pendingQuestionNotificationFromPushData(
    data: Map<String, String>,
    tapTargetFactory: NotificationTapTargetFactory = NotificationTapTargetFactory()
): PendingQuestionNotification? {
    if (data[KEY_TYPE] != TYPE_ASK_CREATED) return null
    val requestId = data[KEY_REQUEST_ID]?.takeIf { it.isNotBlank() } ?: return null

    return PendingQuestionNotification(
        requestId = requestId,
        title = data[KEY_TITLE]?.takeIf { it.isNotBlank() } ?: DEFAULT_TITLE,
        message = data[KEY_BODY]?.takeIf { it.isNotBlank() } ?: DEFAULT_MESSAGE,
        tapTarget = tapTargetFactory.openQuestion(requestId)
    )
}

/**
 * Extracts the requestId of a resolved (answered, cancelled, or expired) question from a server
 * dismissal push so any still-visible notification for it can be cancelled.
 */
fun resolvedQuestionRequestIdFromPushData(data: Map<String, String>): String? {
    if (data[KEY_TYPE] != TYPE_ASK_RESOLVED) return null
    return data[KEY_REQUEST_ID]?.takeIf { it.isNotBlank() }
}

const val TYPE_ASK_CREATED: String = "ask.created"
const val TYPE_ASK_RESOLVED: String = "ask.resolved"
private const val KEY_TYPE = "type"
private const val KEY_REQUEST_ID = "requestId"
private const val KEY_TITLE = "title"
private const val KEY_BODY = "body"
private const val DEFAULT_TITLE = "New Postbox question"
private const val DEFAULT_MESSAGE = "A Postbox session needs your input."

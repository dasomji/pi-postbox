package dev.pi.postbox.notification

import dev.pi.postbox.protocol.AskRequestSnapshot
import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.protocol.StateSnapshot
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * App-owned notification decision layer.
 *
 * The tracker is intentionally side-effect free: callers feed each fetched/SSE state snapshot into
 * [observe] and post any returned events through the Android notification APIs only if permission
 * and lifecycle policy allow it. The first snapshot is treated as already-visible app state so a
 * user opening the app does not get notified for questions they can already see.
 */
class PendingQuestionNotificationTracker(
    private val tapTargetFactory: NotificationTapTargetFactory = NotificationTapTargetFactory()
) {
    private val seenRequestIds = linkedSetOf<String>()
    private var hasBaseline = false

    fun observe(snapshot: StateSnapshot): List<PendingQuestionNotification> {
        val requestsById = snapshot.requests.associateBy { it.requestId }

        if (!hasBaseline) {
            seenRequestIds.addAll(requestsById.keys)
            hasBaseline = true
            return emptyList()
        }

        val newlyObservedPendingRequests = snapshot.requests
            .filter { request -> request.status == AskStatus.PENDING && request.requestId !in seenRequestIds }

        seenRequestIds.addAll(requestsById.keys)

        return newlyObservedPendingRequests.map { request -> request.toNotificationEvent(tapTargetFactory) }
    }
}

data class PendingQuestionNotification(
    val requestId: String,
    val title: String,
    val message: String,
    val tapTarget: NotificationTapTarget
)

sealed interface NotificationTapTarget {
    val intentAction: String

    fun toDeepLinkUri(): String

    data class OpenQuestion(val requestId: String) : NotificationTapTarget {
        override val intentAction: String = ACTION_OPEN_QUESTION

        override fun toDeepLinkUri(): String = "postbox://questions/${requestId.urlEncodePathSegment()}"
    }

    companion object {
        const val ACTION_OPEN_QUESTION: String = "dev.pi.postbox.OPEN_QUESTION"

        fun requestIdFromDeepLinkUri(value: String): String? {
            val uri = runCatching { URI(value) }.getOrNull() ?: return null
            if (uri.scheme != "postbox" || uri.host != "questions") return null
            val encodedRequestId = uri.rawPath
                ?.removePrefix("/")
                ?.takeIf { it.isNotBlank() }
                ?: return null
            return URLDecoder.decode(encodedRequestId, StandardCharsets.UTF_8.toString())
        }
    }
}

class NotificationTapTargetFactory(
    @Suppress("UNUSED_PARAMETER") baseUrl: String? = null
) {
    fun openQuestion(requestId: String): NotificationTapTarget = NotificationTapTarget.OpenQuestion(requestId)
}

class NotificationPermissionPolicy(private val androidSdkInt: Int) {
    fun shouldRequestRuntimePermission(permissionGranted: Boolean): Boolean =
        androidSdkInt >= ANDROID_13_API_LEVEL && !permissionGranted

    fun permissionState(permissionGranted: Boolean): NotificationPermissionState = when {
        androidSdkInt < ANDROID_13_API_LEVEL -> NotificationPermissionState.NotRequired
        permissionGranted -> NotificationPermissionState.Granted
        else -> NotificationPermissionState.Denied
    }

    companion object {
        const val ANDROID_13_API_LEVEL: Int = 33
    }
}

data class NotificationAvailability(
    val canPostNotifications: Boolean,
    val questionWorkflowRemainsUsable: Boolean,
    val requiresBlockingPermissionPrompt: Boolean,
    val statusMessage: String
)

sealed interface NotificationPermissionState {
    fun toAvailability(): NotificationAvailability

    data object Granted : NotificationPermissionState {
        override fun toAvailability(): NotificationAvailability = NotificationAvailability(
            canPostNotifications = true,
            questionWorkflowRemainsUsable = true,
            requiresBlockingPermissionPrompt = false,
            statusMessage = "Notifications enabled for newly observed Postbox questions."
        )
    }

    data object Denied : NotificationPermissionState {
        override fun toAvailability(): NotificationAvailability = NotificationAvailability(
            canPostNotifications = false,
            questionWorkflowRemainsUsable = true,
            requiresBlockingPermissionPrompt = false,
            statusMessage = "Notifications are disabled, but questions can still be loaded, answered, and cancelled in the app."
        )
    }

    data object NotRequired : NotificationPermissionState {
        override fun toAvailability(): NotificationAvailability = NotificationAvailability(
            canPostNotifications = true,
            questionWorkflowRemainsUsable = true,
            requiresBlockingPermissionPrompt = false,
            statusMessage = "This Android version does not require runtime notification permission."
        )
    }

    data object Unknown : NotificationPermissionState {
        override fun toAvailability(): NotificationAvailability = NotificationAvailability(
            canPostNotifications = false,
            questionWorkflowRemainsUsable = true,
            requiresBlockingPermissionPrompt = false,
            statusMessage = "Notification permission has not been checked yet; the question workflow remains available."
        )
    }
}

private fun AskRequestSnapshot.toNotificationEvent(
    tapTargetFactory: NotificationTapTargetFactory
): PendingQuestionNotification = PendingQuestionNotification(
    requestId = requestId,
    title = "New Postbox question",
    message = question.prompt,
    tapTarget = tapTargetFactory.openQuestion(requestId)
)

private fun String.urlEncodePathSegment(): String = URLEncoder
    .encode(this, StandardCharsets.UTF_8.toString())
    .replace("+", "%20")

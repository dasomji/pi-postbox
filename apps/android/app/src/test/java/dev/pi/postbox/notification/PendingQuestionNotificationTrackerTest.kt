package dev.pi.postbox.notification

import dev.pi.postbox.protocol.AskStatus
import dev.pi.postbox.question.VERIFIED_BASE_URL
import dev.pi.postbox.question.questionWorkflowState
import dev.pi.postbox.question.singlePendingQuestion
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingQuestionNotificationTrackerTest {
    @Test
    fun newlyObservedPendingRequestIdsEmitOneNotificationWithQuestionTapTarget() {
        val tracker = PendingQuestionNotificationTracker(
            tapTargetFactory = NotificationTapTargetFactory(baseUrl = VERIFIED_BASE_URL)
        )

        val firstObservedState = questionWorkflowState(
            requests = listOf(singlePendingQuestion(requestId = "ask-existing"))
        )
        assertEquals(
            "first observation establishes the baseline and must not notify for already-visible questions",
            emptyList<PendingQuestionNotification>(),
            tracker.observe(firstObservedState)
        )

        val events = tracker.observe(
            questionWorkflowState(
                requests = listOf(
                    singlePendingQuestion(requestId = "ask-existing"),
                    singlePendingQuestion(
                        requestId = "ask-new",
                        prompt = "Approve the native install workflow?"
                    )
                )
            )
        )

        assertEquals(listOf("ask-new"), events.map { it.requestId })
        assertEquals("New Postbox question", events.single().title)
        assertEquals("Approve the native install workflow?", events.single().message)
        assertEquals(
            NotificationTapTarget.OpenQuestion(requestId = "ask-new"),
            events.single().tapTarget
        )
        assertEquals(
            "postbox://questions/ask-new",
            events.single().tapTarget.toDeepLinkUri()
        )
        assertEquals(
            "dev.pi.postbox.OPEN_QUESTION",
            events.single().tapTarget.intentAction
        )
    }

    @Test
    fun replayedOrPreviouslySeenRequestIdsDoNotDuplicateNotifications() {
        val tracker = PendingQuestionNotificationTracker(
            tapTargetFactory = NotificationTapTargetFactory(baseUrl = VERIFIED_BASE_URL)
        )

        tracker.observe(questionWorkflowState(requests = emptyList()))

        val firstEvent = tracker.observe(
            questionWorkflowState(requests = listOf(singlePendingQuestion(requestId = "ask-repeat")))
        )
        assertEquals(listOf("ask-repeat"), firstEvent.map { it.requestId })

        assertEquals(
            "replaying the same state/SSE snapshot must be idempotent",
            emptyList<PendingQuestionNotification>(),
            tracker.observe(questionWorkflowState(requests = listOf(singlePendingQuestion(requestId = "ask-repeat"))))
        )

        assertEquals(
            "resolved snapshots for a seen request id must not notify",
            emptyList<PendingQuestionNotification>(),
            tracker.observe(
                questionWorkflowState(
                    requests = listOf(singlePendingQuestion(requestId = "ask-repeat", status = AskStatus.ANSWERED))
                )
            )
        )

        assertEquals(
            "a request id that returns in a later pending snapshot is still the same already-notified question",
            emptyList<PendingQuestionNotification>(),
            tracker.observe(questionWorkflowState(requests = listOf(singlePendingQuestion(requestId = "ask-repeat"))))
        )
    }

    @Test
    fun tapTargetDeepLinkRoundTripsUrlEncodedRequestIds() {
        val tapTarget = NotificationTapTarget.OpenQuestion(requestId = "ask/needs encoding")

        val deepLink = tapTarget.toDeepLinkUri()

        assertEquals("postbox://questions/ask%2Fneeds%20encoding", deepLink)
        assertEquals("ask/needs encoding", NotificationTapTarget.requestIdFromDeepLinkUri(deepLink))
        assertEquals(null, NotificationTapTarget.requestIdFromDeepLinkUri("postbox://sessions/not-a-question"))
    }

    @Test
    fun android13NotificationPermissionPolicyRequestsPermissionAndDenialDoesNotBlockWorkflow() {
        val policy = NotificationPermissionPolicy(androidSdkInt = 33)

        assertTrue(policy.shouldRequestRuntimePermission(permissionGranted = false))
        assertEquals(NotificationPermissionState.Denied, policy.permissionState(permissionGranted = false))
        assertEquals(NotificationPermissionState.Granted, policy.permissionState(permissionGranted = true))
        assertTrue(NotificationPermissionState.Denied.toAvailability().questionWorkflowRemainsUsable)
    }

    @Test
    fun preAndroid13NotificationPermissionPolicyDoesNotRequireRuntimePermission() {
        val policy = NotificationPermissionPolicy(androidSdkInt = 32)

        assertFalse(policy.shouldRequestRuntimePermission(permissionGranted = false))
        assertEquals(NotificationPermissionState.NotRequired, policy.permissionState(permissionGranted = false))
        assertTrue(NotificationPermissionState.NotRequired.toAvailability().canPostNotifications)
    }

    @Test
    fun deniedNotificationPermissionDisablesOnlyNotificationsNotTheQuestionWorkflow() {
        val availability = NotificationPermissionState.Denied.toAvailability()

        assertFalse(availability.canPostNotifications)
        assertTrue(
            "denying Android 13+ notification permission must not block loading, viewing, answering, or cancelling questions",
            availability.questionWorkflowRemainsUsable
        )
        assertFalse(availability.requiresBlockingPermissionPrompt)
        assertTrue(availability.statusMessage.contains("notifications", ignoreCase = true))
        assertTrue(availability.statusMessage.contains("disabled", ignoreCase = true))
    }
}

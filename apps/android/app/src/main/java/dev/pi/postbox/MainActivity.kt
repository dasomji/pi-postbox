package dev.pi.postbox

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import dev.pi.postbox.notification.AndroidNotificationPermissionController
import dev.pi.postbox.notification.AndroidPendingQuestionNotifier
import dev.pi.postbox.notification.NotificationPermissionState
import dev.pi.postbox.notification.PendingQuestionNotificationTracker
import dev.pi.postbox.notification.postboxNotificationRequestId
import dev.pi.postbox.onboarding.InvalidServerUrlReason
import dev.pi.postbox.onboarding.OkHttpPostboxHealthVerifier
import dev.pi.postbox.onboarding.ServerOnboardingState
import dev.pi.postbox.onboarding.ServerOnboardingViewModel
import dev.pi.postbox.onboarding.ServerUrlWarning
import dev.pi.postbox.onboarding.SharedPreferencesVerifiedServerUrlStore
import dev.pi.postbox.protocol.OkHttpPostboxProtocolClient
import dev.pi.postbox.protocol.OkHttpPostboxStateStream
import dev.pi.postbox.push.PostboxFcmTokenRegistration
import dev.pi.postbox.question.QuestionWorkflowScreen
import dev.pi.postbox.question.QuestionWorkflowViewModel
import dev.pi.postbox.ui.theme.PostalColors
import dev.pi.postbox.ui.theme.PostboxTheme
import dev.pi.postbox.ui.theme.postalStripes
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var notificationPermissionController: AndroidNotificationPermissionController
    private var notificationPermissionState: NotificationPermissionState by mutableStateOf(NotificationPermissionState.Unknown)
    private var openQuestionRequestId: String? by mutableStateOf(null)

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        notificationPermissionState = if (granted) NotificationPermissionState.Granted else NotificationPermissionState.Denied
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        notificationPermissionController = AndroidNotificationPermissionController(applicationContext)
        notificationPermissionState = notificationPermissionController.currentState()
        openQuestionRequestId = intent.postboxNotificationRequestId()

        setContent {
            val viewModel = remember {
                ServerOnboardingViewModel(
                    verifier = OkHttpPostboxHealthVerifier(),
                    store = SharedPreferencesVerifiedServerUrlStore(applicationContext)
                ).also { it.loadSavedServerUrl() }
            }

            PostboxApp(
                viewModel = viewModel,
                lifecycle = lifecycle,
                notificationPermissionState = notificationPermissionState,
                openQuestionRequestId = openQuestionRequestId,
                onOpenQuestionRequestConsumed = { openQuestionRequestId = null },
                onRequestNotificationPermissionIfNeeded = ::requestNotificationPermissionIfNeeded
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openQuestionRequestId = intent.postboxNotificationRequestId()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (notificationPermissionController.shouldRequestRuntimePermission()) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@Composable
private fun RequestNotificationPermissionOnce(onRequestNotificationPermissionIfNeeded: () -> Unit) {
    LaunchedEffect(Unit) {
        onRequestNotificationPermissionIfNeeded()
    }
}

@Composable
private fun PostboxApp(
    viewModel: ServerOnboardingViewModel,
    lifecycle: Lifecycle,
    notificationPermissionState: NotificationPermissionState,
    openQuestionRequestId: String?,
    onOpenQuestionRequestConsumed: () -> Unit,
    onRequestNotificationPermissionIfNeeded: () -> Unit
) {
    PostboxTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background
        ) {
            when (val state = viewModel.state) {
                is ServerOnboardingState.Ready -> {
                    RequestNotificationPermissionOnce(onRequestNotificationPermissionIfNeeded)
                    ConnectedQuestionWorkflow(
                        state = state,
                        lifecycle = lifecycle,
                        notificationPermissionState = notificationPermissionState,
                        openQuestionRequestId = openQuestionRequestId,
                        onOpenQuestionRequestConsumed = onOpenQuestionRequestConsumed,
                        onEditServerUrl = viewModel::editServerUrl
                    )
                }
                else -> ServerOnboardingScreen(
                    serverUrl = viewModel.serverUrl,
                    state = state,
                    onServerUrlChanged = viewModel::onServerUrlChanged,
                    onVerify = { viewModel.verifyAndSaveFromUi() }
                )
            }
        }
    }
}

@Composable
private fun ServerOnboardingScreen(
    serverUrl: String,
    state: ServerOnboardingState,
    onServerUrlChanged: (String) -> Unit,
    onVerify: suspend () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val verifying = state is ServerOnboardingState.Verifying

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(24.dp),
            horizontalAlignment = Alignment.Start,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "Connect to Pi Postbox",
                style = MaterialTheme.typography.headlineMedium,
                color = PostalColors.text
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Enter the explicit HTTPS Tailnet URL for your Postbox server.",
                style = MaterialTheme.typography.bodyLarge,
                color = PostalColors.subtle
            )
            Spacer(modifier = Modifier.height(24.dp))
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = serverUrl,
                onValueChange = onServerUrlChanged,
                label = { Text("Server URL") },
                placeholder = { Text("https://postbox.tailnet.example:32187") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = PostalColors.attentionBorder,
                    unfocusedBorderColor = PostalColors.border,
                    focusedContainerColor = PostalColors.elevated,
                    unfocusedContainerColor = PostalColors.elevated,
                    cursorColor = PostalColors.attention,
                    focusedLabelColor = PostalColors.subtle,
                    unfocusedLabelColor = PostalColors.muted,
                    focusedTextColor = PostalColors.text,
                    unfocusedTextColor = PostalColors.text
                ),
                isError = state is ServerOnboardingState.InvalidUrl ||
                    state is ServerOnboardingState.Unreachable ||
                    state is ServerOnboardingState.NonPostboxServer ||
                    state is ServerOnboardingState.InvalidHealthResponse,
                supportingText = { OnboardingSupportingText(state) }
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                enabled = !verifying,
                onClick = {
                    coroutineScope.launch { onVerify() }
                }
            ) {
                Text(if (verifying) "Checking…" else "Verify server")
            }
        }

        // Airmail envelope edge along the bottom, matching the question screen.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .height(3.dp)
                .alpha(0.7f)
                .postalStripes()
        )
    }
}

@Composable
private fun OnboardingSupportingText(state: ServerOnboardingState) {
    val text = when (state) {
        is ServerOnboardingState.InvalidUrl -> when (state.reason) {
            InvalidServerUrlReason.MISSING_SCHEME -> "Include an explicit http:// or https:// scheme."
            InvalidServerUrlReason.UNSUPPORTED_SCHEME -> "Only http:// and https:// server URLs are supported."
            InvalidServerUrlReason.MALFORMED_URL -> "Enter a valid server URL."
            InvalidServerUrlReason.NON_LOCAL_HTTP -> "Use HTTPS, or http://localhost, http://127.0.0.1, or http://10.0.2.2 for local development."
        }
        is ServerOnboardingState.Unreachable -> "Could not reach ${state.baseUrl}. Check the URL and try again."
        is ServerOnboardingState.NonPostboxServer -> "${state.baseUrl} answered, but it is not a Pi Postbox server."
        is ServerOnboardingState.InvalidHealthResponse -> "${state.baseUrl} did not return a valid Postbox health response."
        is ServerOnboardingState.Verifying -> "Checking ${state.baseUrl}/healthz…"
        else -> "The app will verify /healthz before saving this URL."
    }
    val warning = when (state) {
        is ServerOnboardingState.Verifying -> state.warning
        is ServerOnboardingState.Unreachable -> state.warning
        is ServerOnboardingState.NonPostboxServer -> state.warning
        is ServerOnboardingState.InvalidHealthResponse -> state.warning
        else -> null
    }
    val warningText = warning?.toDisplayText()

    Text(text = if (warningText == null) text else "$text $warningText")
}

private fun ServerUrlWarning.toDisplayText(): String = when (this) {
    ServerUrlWarning.LOCAL_HTTP_ONLY -> "Local HTTP is for emulator/development use only; use HTTPS for Tailnet servers."
}

@Composable
private fun ConnectedQuestionWorkflow(
    state: ServerOnboardingState.Ready,
    lifecycle: Lifecycle,
    notificationPermissionState: NotificationPermissionState,
    openQuestionRequestId: String?,
    onOpenQuestionRequestConsumed: () -> Unit,
    onEditServerUrl: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val appContext = LocalContext.current.applicationContext
    val notificationPoster = remember(appContext) {
        AndroidPendingQuestionNotifier(appContext)
    }
    val workflowViewModel = remember(state.baseUrl) {
        QuestionWorkflowViewModel(
            baseUrl = state.baseUrl,
            protocolClient = OkHttpPostboxProtocolClient(state.baseUrl),
            stateStream = OkHttpPostboxStateStream(state.baseUrl),
            coroutineScope = coroutineScope,
            initialNotificationPermissionState = notificationPermissionState,
            pendingQuestionNotificationTracker = PendingQuestionNotificationTracker(),
            onPendingQuestionNotifications = notificationPoster::postAll,
            onPendingRequestIdsObserved = notificationPoster::reconcilePendingRequests
        )
    }

    DisposableEffect(workflowViewModel, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> workflowViewModel.start()
                Lifecycle.Event.ON_STOP -> workflowViewModel.close()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            workflowViewModel.start()
        }
        onDispose {
            lifecycle.removeObserver(observer)
            workflowViewModel.close()
        }
    }
    LaunchedEffect(workflowViewModel, notificationPermissionState) {
        workflowViewModel.updateNotificationPermissionState(notificationPermissionState)
    }
    LaunchedEffect(state.baseUrl) {
        PostboxFcmTokenRegistration.registerIfAvailable(appContext, state.baseUrl)
    }
    LaunchedEffect(workflowViewModel, openQuestionRequestId) {
        openQuestionRequestId?.let { requestId ->
            workflowViewModel.openQuestionFromNotification(requestId)
            onOpenQuestionRequestConsumed()
        }
    }

    QuestionWorkflowScreen(
        state = workflowViewModel.state,
        onShowQueue = workflowViewModel::showQueue,
        onSelectProject = workflowViewModel::selectProject,
        onSelectSession = workflowViewModel::selectSession,
        onSelectQuestion = workflowViewModel::selectQuestion,
        onToggleOption = workflowViewModel::toggleOption,
        onSubmitAnswer = workflowViewModel::submitAnswer,
        onCancelQuestion = workflowViewModel::cancelQuestion,
        onDismissQuestion = workflowViewModel::dismissQuestion,
        onEditServerUrl = onEditServerUrl
    )
}

@Preview(showBackground = true)
@Composable
private fun ServerOnboardingPreview() {
    PostboxTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            ServerOnboardingScreen(
                serverUrl = "",
                state = ServerOnboardingState.Editing(),
                onServerUrlChanged = {},
                onVerify = {}
            )
        }
    }
}

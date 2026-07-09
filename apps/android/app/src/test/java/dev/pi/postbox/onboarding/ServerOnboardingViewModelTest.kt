package dev.pi.postbox.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerOnboardingViewModelTest {
    @Test
    fun invalidUrlShowsValidationErrorAndDoesNotCallHealthVerifier() {
        val verifier = RecordingHealthVerifier(HealthVerificationResult.Unreachable("should not be called"))
        val store = InMemoryVerifiedServerUrlStore()
        val viewModel = ServerOnboardingViewModel(verifier, store)

        viewModel.onServerUrlChanged("not-a-url")
        viewModel.verifyAndSave()

        assertTrue(viewModel.state is ServerOnboardingState.InvalidUrl)
        assertEquals(
            InvalidServerUrlReason.MISSING_SCHEME,
            (viewModel.state as ServerOnboardingState.InvalidUrl).reason
        )
        assertEquals(emptyList<String>(), verifier.requestedBaseUrls)
        assertNull(store.savedBaseUrl)
    }

    @Test
    fun unreachableUrlShowsRetryableErrorWithoutSaving() {
        val verifier = RecordingHealthVerifier(HealthVerificationResult.Unreachable("connection refused"))
        val store = InMemoryVerifiedServerUrlStore()
        val viewModel = ServerOnboardingViewModel(verifier, store)

        viewModel.onServerUrlChanged("https://postbox.tailnet.example:32187")
        viewModel.verifyAndSave()

        assertEquals(listOf("https://postbox.tailnet.example:32187/"), verifier.requestedBaseUrls)
        assertTrue(viewModel.state is ServerOnboardingState.Unreachable)
        assertEquals(
            "https://postbox.tailnet.example:32187/",
            (viewModel.state as ServerOnboardingState.Unreachable).baseUrl
        )
        assertNull(store.savedBaseUrl)
    }

    @Test
    fun nonPostboxHealthShowsRejectedServerErrorWithoutSaving() {
        val verifier = RecordingHealthVerifier(
            HealthVerificationResult.Rejected(HealthRejectionReason.NON_POSTBOX_HEALTH)
        )
        val store = InMemoryVerifiedServerUrlStore()
        val viewModel = ServerOnboardingViewModel(verifier, store)

        viewModel.onServerUrlChanged("https://postbox.tailnet.example:32187")
        viewModel.verifyAndSave()

        assertTrue(viewModel.state is ServerOnboardingState.NonPostboxServer)
        assertEquals(
            "https://postbox.tailnet.example:32187/",
            (viewModel.state as ServerOnboardingState.NonPostboxServer).baseUrl
        )
        assertNull(store.savedBaseUrl)
    }

    @Test
    fun validPostboxHealthSavesNormalizedUrlAndEntersTheApp() {
        val verifier = RecordingHealthVerifier(
            HealthVerificationResult.Valid(
                baseUrl = "https://postbox.tailnet.example:32187/",
                service = "pi-postbox",
                version = "0.1.0",
                protocolVersion = "0.1.0"
            )
        )
        val store = InMemoryVerifiedServerUrlStore()
        val viewModel = ServerOnboardingViewModel(verifier, store)

        viewModel.onServerUrlChanged("https://postbox.tailnet.example:32187")
        viewModel.verifyAndSave()

        assertEquals("https://postbox.tailnet.example:32187/", store.savedBaseUrl)
        assertTrue(viewModel.state is ServerOnboardingState.Ready)
        val ready = viewModel.state as ServerOnboardingState.Ready
        assertEquals(
            "https://postbox.tailnet.example:32187/",
            ready.baseUrl
        )
        assertEquals("pi-postbox", ready.health?.service)
        assertEquals("0.1.0", ready.health?.version)
        assertEquals("0.1.0", ready.health?.protocolVersion)
    }

    @Test
    fun localHttpDeveloperUrlCarriesWarningAfterVerification() {
        val verifier = RecordingHealthVerifier(
            HealthVerificationResult.Valid(
                baseUrl = "http://10.0.2.2:32187/",
                service = "pi-postbox",
                version = "0.1.0",
                protocolVersion = "0.1.0"
            )
        )
        val store = InMemoryVerifiedServerUrlStore()
        val viewModel = ServerOnboardingViewModel(verifier, store)

        viewModel.onServerUrlChanged("http://10.0.2.2:32187")
        viewModel.verifyAndSave()

        val ready = viewModel.state as ServerOnboardingState.Ready
        assertEquals(ServerUrlWarning.LOCAL_HTTP_ONLY, ready.warning)
    }

    @Test
    fun editServerUrlAllowsReplacingPreviouslySavedUrl() {
        val store = InMemoryVerifiedServerUrlStore(initial = "https://old-postbox.tailnet.example:32187/")
        val verifier = RecordingHealthVerifier(
            HealthVerificationResult.Valid(
                baseUrl = "https://new-postbox.tailnet.example:32187/",
                service = "pi-postbox",
                version = "0.2.0",
                protocolVersion = "0.1.0"
            )
        )
        val viewModel = ServerOnboardingViewModel(verifier, store)
        viewModel.loadSavedServerUrl()

        viewModel.editServerUrl()
        assertTrue(viewModel.state is ServerOnboardingState.Editing)
        assertEquals("https://old-postbox.tailnet.example:32187/", viewModel.serverUrl)

        viewModel.onServerUrlChanged("https://new-postbox.tailnet.example:32187")
        viewModel.verifyAndSave()

        assertEquals(listOf("https://new-postbox.tailnet.example:32187/"), verifier.requestedBaseUrls)
        assertEquals("https://new-postbox.tailnet.example:32187/", store.savedBaseUrl)
        val ready = viewModel.state as ServerOnboardingState.Ready
        assertEquals("https://new-postbox.tailnet.example:32187/", ready.baseUrl)
        assertEquals("0.2.0", ready.health?.version)
    }

    @Test
    fun savedVerifiedUrlIsLoadedOnRestartWithoutRecheckingHealth() {
        val store = InMemoryVerifiedServerUrlStore(initial = "https://postbox.tailnet.example:32187/")
        val verifier = RecordingHealthVerifier(HealthVerificationResult.Unreachable("should not be called on load"))

        val viewModel = ServerOnboardingViewModel(verifier, store)
        viewModel.loadSavedServerUrl()

        assertTrue(viewModel.state is ServerOnboardingState.Ready)
        assertEquals(
            "https://postbox.tailnet.example:32187/",
            (viewModel.state as ServerOnboardingState.Ready).baseUrl
        )
        assertEquals(emptyList<String>(), verifier.requestedBaseUrls)
    }

    private class RecordingHealthVerifier(
        var result: HealthVerificationResult
    ) : PostboxHealthVerifier {
        val requestedBaseUrls = mutableListOf<String>()

        override fun verify(baseUrl: String): HealthVerificationResult {
            requestedBaseUrls.add(baseUrl)
            return result
        }
    }

    private class InMemoryVerifiedServerUrlStore(
        initial: String? = null
    ) : VerifiedServerUrlStore {
        var savedBaseUrl: String? = initial
            private set

        override fun saveVerifiedServerUrl(baseUrl: String) {
            savedBaseUrl = baseUrl
        }

        override fun loadVerifiedServerUrl(): String? = savedBaseUrl
    }
}

package dev.pi.postbox.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ServerOnboardingViewModel(
    private val verifier: PostboxHealthVerifier,
    private val store: VerifiedServerUrlStore
) {
    var serverUrl by mutableStateOf("")
        private set

    var state: ServerOnboardingState by mutableStateOf(ServerOnboardingState.Editing())
        private set

    fun loadSavedServerUrl() {
        val savedBaseUrl = store.loadVerifiedServerUrl()
        if (savedBaseUrl != null) {
            serverUrl = savedBaseUrl
            state = ServerOnboardingState.Ready(baseUrl = savedBaseUrl)
        }
    }

    fun onServerUrlChanged(input: String) {
        serverUrl = input
        state = ServerOnboardingState.Editing(input)
    }

    fun editServerUrl() {
        state = ServerOnboardingState.Editing(serverUrl)
    }

    fun verifyAndSave() {
        val normalized = ServerUrlNormalizer.normalize(serverUrl)
        if (normalized !is ServerUrlValidationResult.Valid) {
            state = ServerOnboardingState.InvalidUrl(
                input = serverUrl,
                reason = (normalized as ServerUrlValidationResult.Invalid).reason
            )
            return
        }

        state = ServerOnboardingState.Verifying(normalized.baseUrl, normalized.warning)
        handleVerificationResult(
            normalizedBaseUrl = normalized.baseUrl,
            warning = normalized.warning,
            result = verifier.verify(normalized.baseUrl)
        )
    }

    suspend fun verifyAndSaveFromUi() {
        val input = serverUrl
        val normalized = ServerUrlNormalizer.normalize(input)
        if (normalized !is ServerUrlValidationResult.Valid) {
            state = ServerOnboardingState.InvalidUrl(
                input = input,
                reason = (normalized as ServerUrlValidationResult.Invalid).reason
            )
            return
        }

        state = ServerOnboardingState.Verifying(normalized.baseUrl, normalized.warning)
        val result = withContext(Dispatchers.IO) {
            verifier.verify(normalized.baseUrl)
        }
        handleVerificationResult(
            normalizedBaseUrl = normalized.baseUrl,
            warning = normalized.warning,
            result = result
        )
    }

    private fun handleVerificationResult(
        normalizedBaseUrl: String,
        warning: ServerUrlWarning?,
        result: HealthVerificationResult
    ) {
        when (result) {
            is HealthVerificationResult.Valid -> {
                serverUrl = normalizedBaseUrl
                store.saveVerifiedServerUrl(normalizedBaseUrl)
                state = ServerOnboardingState.Ready(
                    baseUrl = normalizedBaseUrl,
                    health = VerifiedPostboxHealth(
                        service = result.service,
                        version = result.version,
                        protocolVersion = result.protocolVersion
                    ),
                    warning = warning
                )
            }
            is HealthVerificationResult.Unreachable -> {
                state = ServerOnboardingState.Unreachable(
                    baseUrl = normalizedBaseUrl,
                    message = result.message,
                    warning = warning
                )
            }
            is HealthVerificationResult.Rejected -> {
                state = when (result.reason) {
                    HealthRejectionReason.NON_POSTBOX_HEALTH -> ServerOnboardingState.NonPostboxServer(
                        baseUrl = normalizedBaseUrl,
                        warning = warning
                    )
                    HealthRejectionReason.MALFORMED_HEALTH_RESPONSE -> ServerOnboardingState.InvalidHealthResponse(
                        baseUrl = normalizedBaseUrl,
                        warning = warning
                    )
                }
            }
        }
    }
}

sealed class ServerOnboardingState {
    data class Editing(val input: String = "") : ServerOnboardingState()
    data class Verifying(
        val baseUrl: String,
        val warning: ServerUrlWarning? = null
    ) : ServerOnboardingState()
    data class InvalidUrl(
        val input: String,
        val reason: InvalidServerUrlReason
    ) : ServerOnboardingState()
    data class Unreachable(
        val baseUrl: String,
        val message: String,
        val warning: ServerUrlWarning? = null
    ) : ServerOnboardingState()
    data class NonPostboxServer(
        val baseUrl: String,
        val warning: ServerUrlWarning? = null
    ) : ServerOnboardingState()
    data class InvalidHealthResponse(
        val baseUrl: String,
        val warning: ServerUrlWarning? = null
    ) : ServerOnboardingState()
    data class Ready(
        val baseUrl: String,
        val health: VerifiedPostboxHealth? = null,
        val warning: ServerUrlWarning? = null
    ) : ServerOnboardingState()
}

data class VerifiedPostboxHealth(
    val service: String,
    val version: String,
    val protocolVersion: String
)

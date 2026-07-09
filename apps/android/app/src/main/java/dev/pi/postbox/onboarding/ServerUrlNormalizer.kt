package dev.pi.postbox.onboarding

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object ServerUrlNormalizer {
    fun normalize(input: String): ServerUrlValidationResult {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.MISSING_SCHEME)
        }

        if (!trimmed.contains("://")) {
            return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.MISSING_SCHEME)
        }

        val scheme = trimmed.substringBefore("://").lowercase()
        if (scheme != "http" && scheme != "https") {
            return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.UNSUPPORTED_SCHEME)
        }

        val parsed = trimmed.toHttpUrlOrNull()
            ?: return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.MALFORMED_URL)

        if (parsed.host.isBlank()) {
            return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.MALFORMED_URL)
        }

        if (scheme == "http" && !parsed.host.isLocalDevelopmentHttpHost()) {
            return ServerUrlValidationResult.Invalid(InvalidServerUrlReason.NON_LOCAL_HTTP)
        }

        val base = parsed.newBuilder()
            .encodedPath("/")
            .query(null)
            .fragment(null)
            .build()

        val health = base.newBuilder()
            .addPathSegment("healthz")
            .build()

        return ServerUrlValidationResult.Valid(
            baseUrl = base.toString(),
            healthUrl = health.toString(),
            warning = if (base.isHttps) null else ServerUrlWarning.LOCAL_HTTP_ONLY
        )
    }

    private fun String.isLocalDevelopmentHttpHost(): Boolean = lowercase() in setOf(
        "localhost",
        "127.0.0.1",
        "::1",
        "10.0.2.2"
    )
}

sealed class ServerUrlValidationResult {
    data class Valid(
        val baseUrl: String,
        val healthUrl: String,
        val warning: ServerUrlWarning?
    ) : ServerUrlValidationResult()

    data class Invalid(
        val reason: InvalidServerUrlReason
    ) : ServerUrlValidationResult()
}

enum class InvalidServerUrlReason {
    MISSING_SCHEME,
    UNSUPPORTED_SCHEME,
    MALFORMED_URL,
    NON_LOCAL_HTTP
}

enum class ServerUrlWarning {
    LOCAL_HTTP_ONLY
}

package dev.pi.postbox.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlNormalizerTest {
    @Test
    fun normalizesExplicitHttpsServerUrlForHealthChecks() {
        val result = ServerUrlNormalizer.normalize("  https://postbox.tailnet.example:32187  ")

        assertTrue(result is ServerUrlValidationResult.Valid)
        val valid = result as ServerUrlValidationResult.Valid
        assertEquals("https://postbox.tailnet.example:32187/", valid.baseUrl)
        assertEquals("https://postbox.tailnet.example:32187/healthz", valid.healthUrl)
        assertNull(valid.warning)
    }

    @Test
    fun acceptsHttpLoopbackAsExplicitDeveloperUrlButMarksItNonPreferred() {
        val result = ServerUrlNormalizer.normalize("http://127.0.0.1:32187")

        assertTrue(result is ServerUrlValidationResult.Valid)
        val valid = result as ServerUrlValidationResult.Valid
        assertEquals("http://127.0.0.1:32187/", valid.baseUrl)
        assertEquals("http://127.0.0.1:32187/healthz", valid.healthUrl)
        assertEquals(ServerUrlWarning.LOCAL_HTTP_ONLY, valid.warning)
    }

    @Test
    fun acceptsHttpEmulatorHostAsExplicitDeveloperUrlButMarksItNonPreferred() {
        val result = ServerUrlNormalizer.normalize("http://10.0.2.2:32187")

        assertTrue(result is ServerUrlValidationResult.Valid)
        val valid = result as ServerUrlValidationResult.Valid
        assertEquals("http://10.0.2.2:32187/", valid.baseUrl)
        assertEquals("http://10.0.2.2:32187/healthz", valid.healthUrl)
        assertEquals(ServerUrlWarning.LOCAL_HTTP_ONLY, valid.warning)
    }

    @Test
    fun rejectsNonLocalHttpBeforeNetworkUse() {
        val result = ServerUrlNormalizer.normalize("http://postbox.tailnet.example:32187")

        assertTrue(result is ServerUrlValidationResult.Invalid)
        assertEquals(InvalidServerUrlReason.NON_LOCAL_HTTP, (result as ServerUrlValidationResult.Invalid).reason)
    }

    @Test
    fun rejectsHostTextWithoutExplicitSchemeBeforeNetworkUse() {
        val result = ServerUrlNormalizer.normalize("postbox.tailnet.example:32187")

        assertTrue(result is ServerUrlValidationResult.Invalid)
        assertEquals(InvalidServerUrlReason.MISSING_SCHEME, (result as ServerUrlValidationResult.Invalid).reason)
    }

    @Test
    fun rejectsUnsupportedSchemesBeforeNetworkUse() {
        val result = ServerUrlNormalizer.normalize("ftp://postbox.tailnet.example:32187")

        assertTrue(result is ServerUrlValidationResult.Invalid)
        assertEquals(InvalidServerUrlReason.UNSUPPORTED_SCHEME, (result as ServerUrlValidationResult.Invalid).reason)
    }
}

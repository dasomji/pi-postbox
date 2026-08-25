package dev.pi.postbox.push

import android.content.Context
import dev.pi.postbox.protocol.ProtocolMessageSource
import dev.pi.postbox.protocol.ProtocolMismatch
import dev.pi.postbox.protocol.ProtocolMismatchReason
import java.time.Instant

class ProtocolMismatchEvidenceStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun save(mismatch: ProtocolMismatch) {
        preferences.edit()
            .putString(KEY_SUPPORTED, mismatch.supportedVersion)
            .putString(KEY_RECEIVED, mismatch.receivedVersion)
            .putString(KEY_SOURCE, mismatch.source.name)
            .putString(KEY_REASON, mismatch.reason.name)
            .putString(KEY_OBSERVED_AT, mismatch.observedAt.toString())
            .apply()
    }

    fun load(): ProtocolMismatch? {
        val supported = preferences.getString(KEY_SUPPORTED, null) ?: return null
        val source = runCatching { ProtocolMessageSource.valueOf(preferences.getString(KEY_SOURCE, null).orEmpty()) }.getOrNull() ?: return null
        val reason = runCatching { ProtocolMismatchReason.valueOf(preferences.getString(KEY_REASON, null).orEmpty()) }.getOrNull() ?: return null
        val observedAt = runCatching { Instant.parse(preferences.getString(KEY_OBSERVED_AT, null)) }.getOrNull() ?: return null
        return ProtocolMismatch(supported, preferences.getString(KEY_RECEIVED, null), source, observedAt, reason)
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "postbox_protocol_mismatch"
        const val KEY_SUPPORTED = "supported"
        const val KEY_RECEIVED = "received"
        const val KEY_SOURCE = "source"
        const val KEY_REASON = "reason"
        const val KEY_OBSERVED_AT = "observed_at"
    }
}

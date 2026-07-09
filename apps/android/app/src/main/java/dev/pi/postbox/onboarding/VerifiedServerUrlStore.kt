package dev.pi.postbox.onboarding

import android.content.Context
import android.content.SharedPreferences

interface VerifiedServerUrlStore {
    fun saveVerifiedServerUrl(baseUrl: String)
    fun loadVerifiedServerUrl(): String?
}

class SharedPreferencesVerifiedServerUrlStore(
    context: Context
) : VerifiedServerUrlStore {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )

    override fun saveVerifiedServerUrl(baseUrl: String) {
        preferences.edit().putString(KEY_VERIFIED_SERVER_URL, baseUrl).apply()
    }

    override fun loadVerifiedServerUrl(): String? = preferences.getString(KEY_VERIFIED_SERVER_URL, null)

    private companion object {
        const val PREFERENCES_NAME = "postbox_server"
        const val KEY_VERIFIED_SERVER_URL = "verified_server_url"
    }
}

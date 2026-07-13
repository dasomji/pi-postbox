package dev.pi.postbox.push

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Uploads this device's FCM registration token to the verified Postbox server so the server can
 * push new pending questions while the app is closed. A no-op on builds without a
 * google-services.json (Firebase never initializes there).
 */
object PostboxFcmTokenRegistration {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun registerIfAvailable(
        context: Context,
        baseUrl: String,
        registrar: FcmTokenRegistrar = OkHttpFcmTokenRegistrar()
    ) {
        if (FirebaseApp.getApps(context.applicationContext).isEmpty()) return

        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> upload(baseUrl, token, registrar) }
            .addOnFailureListener { error -> Log.w(TAG, "Unable to obtain FCM token.", error) }
    }

    fun upload(baseUrl: String, token: String, registrar: FcmTokenRegistrar = OkHttpFcmTokenRegistrar()) {
        scope.launch {
            runCatching { registrar.register(baseUrl, token) }
                .onFailure { error -> Log.w(TAG, "Unable to register FCM token with Postbox server.", error) }
        }
    }

    private const val TAG = "PostboxFcmRegistration"
}

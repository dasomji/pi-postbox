package dev.pi.postbox.settings

import dev.pi.postbox.protocol.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

val chatEfforts = listOf("off", "minimal", "low", "medium", "high", "xhigh", "max")
data class ChatDefaults(val model: String?, val effort: String)
data class PostboxSettings(val revision: Int, val chat: ChatDefaults)
data class AvailableChatModel(val id: String, val name: String)

class PostboxSettingsClient(
    baseUrl: String,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build(),
    private val gate: ProtocolCompatibilityGate = ProtocolCompatibilityGate()
) {
    private val url = baseUrl.toPostboxBaseUrl().withPathSegments(listOf("api", "settings"))
    private val modelsUrl = baseUrl.toPostboxBaseUrl().withPathSegments(listOf("api", "settings", "models"))

    suspend fun fetchModels(): List<AvailableChatModel> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(modelsUrl)
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, gate.supportedVersion)
            .header("Cache-Control", "no-cache").get().build()
        client.newCall(request).execute().use { response ->
            val value = gate.decodeHttpResponse(response.body?.string().orEmpty(), response.code,
                response.header(POSTBOX_PROTOCOL_VERSION_HEADER), ProtocolMessageSource.SETTINGS_HTTP) { it }
            if (!response.isSuccessful) throw IOException("Could not load available models from Pi. Try again.")
            value.getValue("models").jsonArray.map { entry ->
                val model = entry.jsonObject
                AvailableChatModel(model.getValue("id").jsonPrimitive.content, model.getValue("name").jsonPrimitive.content)
            }
        }
    }

    suspend fun fetch(): PostboxSettings = execute(null)
    suspend fun save(value: PostboxSettings): PostboxSettings {
        require(value.chat.effort in chatEfforts) { "Choose a supported effort." }
        require(value.chat.model == null || (value.chat.model.length <= 400 && Regex("^[^\\s/]+/[^\\s]+$").matches(value.chat.model))) {
            "Use a provider/model ID, or leave the model blank for Pi's default."
        }
        return execute(buildJsonObject {
            put("revision", value.revision)
            put("chat", buildJsonObject {
                put("model", value.chat.model?.let(::JsonPrimitive) ?: JsonNull)
                put("effort", value.chat.effort)
            })
        }.toString())
    }

    private suspend fun execute(body: String?): PostboxSettings = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url)
            .header(POSTBOX_CLIENT_PROTOCOL_VERSION_HEADER, gate.supportedVersion)
            .apply { if (body == null) get() else put(body.toRequestBody(JSON_MEDIA_TYPE)) }.build()
        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val value = gate.decodeHttpResponse(raw, response.code, response.header(POSTBOX_PROTOCOL_VERSION_HEADER), ProtocolMessageSource.SETTINGS_HTTP) { it }
            if (response.code == 409) throw IOException("Settings changed on another device. Reload saved settings before saving again.")
            if (!response.isSuccessful) throw IOException("Could not ${if (body == null) "load" else "save"} settings (${response.code}).")
            val chat = value.getValue("chat").jsonObject
            val effort = chat.getValue("effort").jsonPrimitive.content
            if (effort !in chatEfforts) throw IOException("Unknown chat effort: $effort")
            PostboxSettings(value.getValue("revision").jsonPrimitive.int,
                ChatDefaults(chat["model"]?.jsonPrimitive?.contentOrNull, effort))
        }
    }
}

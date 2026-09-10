package dev.pi.postbox.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import dev.pi.postbox.protocol.PostboxProtocolMismatchException
import dev.pi.postbox.protocol.ProtocolMismatch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun PostboxSettingsScreen(baseUrl: String, lifecycle: Lifecycle, onBack: () -> Unit, onProtocolMismatch: (ProtocolMismatch) -> Unit) {
    val client = remember(baseUrl) { PostboxSettingsClient(baseUrl) }
    val scope = rememberCoroutineScope()
    var saved by remember(baseUrl) { mutableStateOf<PostboxSettings?>(null) }
    var model by remember(baseUrl) { mutableStateOf("") }
    var effort by remember(baseUrl) { mutableStateOf("medium") }
    var saving by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var remoteChanged by remember { mutableStateOf(false) }
    var effortMenu by remember { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    var models by remember(baseUrl) { mutableStateOf<List<AvailableChatModel>?>(null) }
    var modelsLoading by remember(baseUrl) { mutableStateOf(false) }
    var modelsError by remember(baseUrl) { mutableStateOf<String?>(null) }
    val legacyModels = listOfNotNull(saved?.chat?.model, model.takeIf { it.isNotEmpty() }).distinct()
        .filter { id -> models?.none { it.id == id } == true }
    val unavailable = model in legacyModels
    val dirty = saved != null && (model.trim() != saved?.chat?.model.orEmpty() || effort != saved?.chat?.effort)

    fun adopt(value: PostboxSettings) {
        saved = value; model = value.chat.model.orEmpty(); effort = value.chat.effort; remoteChanged = false
    }
    fun report(cause: Exception) {
        if (cause is CancellationException) throw cause
        if (cause is PostboxProtocolMismatchException) onProtocolMismatch(cause.mismatch)
        error = cause.message ?: "Could not update settings."
    }
    suspend fun refresh(discard: Boolean = false) {
        if (saving || loading) return
        loading = true
        try {
            val latest = client.fetch()
            val hasEdits = saved != null && (model.trim() != saved?.chat?.model.orEmpty() || effort != saved?.chat?.effort)
            if (discard || !hasEdits) adopt(latest)
            else if (latest.revision != saved?.revision) remoteChanged = true
            error = null
        } catch (cause: Exception) { report(cause) }
        finally { loading = false }
    }
    suspend fun refreshModels() {
        if (modelsLoading) return
        modelsLoading = true; modelsError = null
        try { models = client.fetchModels() }
        catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            if (cause is PostboxProtocolMismatchException) onProtocolMismatch(cause.mismatch)
            models = null; modelsError = cause.message ?: "Could not load models."
        } finally { modelsLoading = false }
    }
    LaunchedEffect(client, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { refreshModels() }
            while (true) { refresh(); delay(5000) }
        }
    }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
        .verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onClick = onBack) { Text("Back to questions") }
        Text("Settings", style = MaterialTheme.typography.headlineMedium)
        Text("Saved on this Postbox server and shared between the web and Android app.")
        Text("Question chat", style = MaterialTheme.typography.titleLarge)
        Text("New chats start a fresh conversation about the question and its options. Existing chats keep their model and effort.")
        if (saved == null && error == null) Text("Loading settings…")
        if (unavailable) Text("The selected model is not available anymore. Choose an available model or Pi's configured default.", color = MaterialTheme.colorScheme.error)
        modelsError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Box {
            OutlinedButton(enabled = saved != null && !saving && !modelsLoading && models != null,
                onClick = { modelMenu = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Default model: " + (model.ifBlank { "Use Pi's configured default" }) + if (unavailable) " (legacy)" else "")
            }
            DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }, modifier = Modifier.heightIn(max = 400.dp)) {
                DropdownMenuItem(text = { Text("Use Pi's configured default") }, onClick = { model = ""; modelMenu = false; notice = null })
                legacyModels.forEach { id -> DropdownMenuItem(text = { Text("$id (legacy)") }, enabled = false, onClick = {}) }
                models.orEmpty().forEach { option -> DropdownMenuItem(text = { Text("${option.name}\n${option.id}") },
                    onClick = { model = option.id; modelMenu = false; notice = null }) }
            }
        }
        Text(if (modelsLoading) "Loading available models…" else "Available models from the server's Pi configuration.", style = MaterialTheme.typography.bodySmall)
        TextButton(enabled = !modelsLoading && !saving, onClick = { scope.launch { refreshModels() } }) { Text("Reload models") }
        Box {
            OutlinedButton(enabled = saved != null && !saving, onClick = { effortMenu = true }) {
                Text("Default effort: ${effortLabel(effort)}")
            }
            DropdownMenu(expanded = effortMenu, onDismissRequest = { effortMenu = false }) {
                chatEfforts.forEach { value -> DropdownMenuItem(text = { Text(effortLabel(value)) },
                    onClick = { effort = value; effortMenu = false; notice = null }) }
            }
        }
        Text("Higher effort can take longer. Pi adjusts effort to what the model supports; chat shows the effective setting.", style = MaterialTheme.typography.bodySmall)
        if (remoteChanged) Text("Settings changed on another device. Reload saved settings before editing again.")
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (!dirty) notice?.let { Text(it) }
        Button(enabled = saved != null && dirty && !saving && !loading && !remoteChanged, onClick = {
            val current = saved ?: return@Button
            saving = true; error = null; notice = null
            scope.launch {
                try { adopt(client.save(PostboxSettings(current.revision, ChatDefaults(model.trim().ifBlank { null }, effort))))
                    notice = "Saved. New chats on all your devices use these defaults." }
                catch (cause: Exception) { report(cause) }
                finally { saving = false }
            }
        }) { Text(if (saving) "Saving…" else "Save settings") }
        TextButton(enabled = !saving && !loading, onClick = { scope.launch { notice = null; refresh(true) } }) { Text("Reload saved settings") }
    }
}

private fun effortLabel(value: String) = when (value) { "xhigh" -> "Extra high"; "max" -> "Maximum"; else -> value.replaceFirstChar { it.uppercase() } }

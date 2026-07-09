package dev.pi.postbox.protocol

import java.io.Closeable
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

interface PostboxStateStream : Closeable {
    val states: SharedFlow<PostboxStateStreamStatus>
    fun start()
}

sealed class PostboxStateStreamStatus {
    data object Connecting : PostboxStateStreamStatus()
    data class Connected(val latestState: StateSnapshot) : PostboxStateStreamStatus()
    data class Reconnecting(val reason: String, val latestState: StateSnapshot? = null) : PostboxStateStreamStatus()
    data class Disconnected(val reason: String, val latestState: StateSnapshot? = null) : PostboxStateStreamStatus()
}

class OkHttpPostboxStateStream(
    baseUrl: String,
    private val client: OkHttpClient = defaultStateStreamHttpClient(),
    private val reconnectDelayMs: Long = 1_000L
) : PostboxStateStream {
    private val eventsUrl: HttpUrl = baseUrl.toPostboxBaseUrl().withPathSegments(listOf("api", "state", "events"))
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutableStates = MutableSharedFlow<PostboxStateStreamStatus>(
        replay = 16,
        extraBufferCapacity = 16
    )
    private val lifecycleLock = Any()
    private var streamJob: Job? = null
    @Volatile private var closed = false
    @Volatile private var currentCall: Call? = null
    @Volatile private var latestStatus: PostboxStateStreamStatus = PostboxStateStreamStatus.Connecting

    override val states: SharedFlow<PostboxStateStreamStatus> = mutableStates

    init {
        emitStatus(PostboxStateStreamStatus.Connecting)
    }

    override fun start() {
        synchronized(lifecycleLock) {
            if (streamJob?.isActive == true) return
            closed = false
            streamJob = scope.launch {
                var latestState: StateSnapshot? = null
                while (isActive && !closed) {
                    emitStatus(
                        latestState?.let { PostboxStateStreamStatus.Reconnecting(reason = "Reconnecting", latestState = it) }
                            ?: PostboxStateStreamStatus.Connecting
                    )

                    val result = openAndConsumeEvents()
                    latestState = result.latestState ?: latestState

                    if (closed || !isActive) break
                    emitStatus(
                        PostboxStateStreamStatus.Reconnecting(
                            reason = result.reason,
                            latestState = latestState
                        )
                    )
                    delay(reconnectDelayMs)
                }
            }
        }
    }

    override fun close() {
        val callToCancel: Call?
        val jobToCancel: Job?
        synchronized(lifecycleLock) {
            closed = true
            callToCancel = currentCall
            jobToCancel = streamJob
            streamJob = null
        }
        callToCancel?.cancel()
        jobToCancel?.cancel()
        val latest = when (val status = latestStatus) {
            is PostboxStateStreamStatus.Connected -> status.latestState
            is PostboxStateStreamStatus.Reconnecting -> status.latestState
            is PostboxStateStreamStatus.Disconnected -> status.latestState
            PostboxStateStreamStatus.Connecting -> null
        }
        emitStatus(PostboxStateStreamStatus.Disconnected("closed", latest))
    }

    private fun emitStatus(status: PostboxStateStreamStatus) {
        latestStatus = status
        mutableStates.tryEmit(status)
    }

    private fun openAndConsumeEvents(): StreamReadResult {
        val request = Request.Builder()
            .url(eventsUrl)
            .header("Accept", "text/event-stream")
            .get()
            .build()

        val call = client.newCall(request)
        synchronized(lifecycleLock) {
            if (closed) {
                call.cancel()
                return StreamReadResult(reason = "closed")
            }
            currentCall = call
        }
        return try {
            call.execute().use { response ->
                if (!response.isSuccessful) {
                    return StreamReadResult(reason = "HTTP ${response.code}")
                }

                val body = response.body ?: return StreamReadResult(reason = "Missing event stream body")
                val source = body.source()
                var eventName: String? = null
                val dataLines = mutableListOf<String>()
                var latestState: StateSnapshot? = null

                fun dispatchEvent() {
                    if (dataLines.isEmpty()) return
                    if (eventName == null || eventName == "state") {
                        val stateJson = dataLines.joinToString(separator = "\n")
                        val decoded = runCatching { PostboxProtocolJson.decodeStateSnapshot(stateJson) }
                        decoded.onSuccess { snapshot ->
                            latestState = snapshot
                            emitStatus(PostboxStateStreamStatus.Connected(snapshot))
                        }.onFailure { error ->
                            emitStatus(
                                PostboxStateStreamStatus.Reconnecting(
                                    reason = "Malformed state event: ${error.message ?: error::class.java.simpleName}",
                                    latestState = latestState
                                )
                            )
                        }
                    }
                    eventName = null
                    dataLines.clear()
                }

                while (!closed && !call.isCanceled()) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.isEmpty() -> dispatchEvent()
                        line.startsWith(":") -> Unit
                        line.startsWith("event:") -> eventName = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> dataLines += line.removePrefix("data:").trimStart()
                    }
                }
                dispatchEvent()

                StreamReadResult(
                    latestState = latestState,
                    reason = if (closed) "closed" else "Event stream ended"
                )
            }
        } catch (exception: IOException) {
            StreamReadResult(reason = exception.message ?: exception::class.java.simpleName)
        } finally {
            synchronized(lifecycleLock) {
                if (currentCall === call) currentCall = null
            }
        }
    }
}

private data class StreamReadResult(
    val latestState: StateSnapshot? = null,
    val reason: String
)

private fun defaultStateStreamHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS)
    .writeTimeout(5, TimeUnit.SECONDS)
    .callTimeout(0, TimeUnit.SECONDS)
    .build()

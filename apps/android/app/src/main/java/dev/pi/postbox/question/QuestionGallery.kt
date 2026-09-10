package dev.pi.postbox.question

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.ImageLoader
import coil3.compose.SubcomposeAsyncImage
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageRequest
import dev.pi.postbox.protocol.QuestionImage
import dev.pi.postbox.protocol.defaultProtocolHttpClient
import dev.pi.postbox.protocol.OkHttpPostboxProtocolClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.Path.Companion.toOkioPath

fun questionImageUrl(baseUrl: String, image: QuestionImage): String = baseUrl.toHttpUrl().newBuilder()
    .encodedPath("/media/images/${image.imageId}").query(null).fragment(null).build().toString()

// One application-scoped cache, using the same HTTP configuration as state reads.
private object QuestionImages {
    private var loader: ImageLoader? = null
    @Synchronized fun loader(context: Context): ImageLoader = loader ?: ImageLoader.Builder(context.applicationContext)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { defaultProtocolHttpClient().newBuilder().followRedirects(false).followSslRedirects(false).build() })) }
        .memoryCache { MemoryCache.Builder().maxSizeBytes(32L * 1024 * 1024).build() }
        .diskCache { DiskCache.Builder().directory(context.cacheDir.resolve("question-images").toOkioPath()).maxSizeBytes(128L * 1024 * 1024).build() }
        .build().also { loader = it }
}

/** Tests inject this composable; no network or bitmap ownership enters workflow state. */
typealias QuestionImageContent = @Composable (String, QuestionImage, Modifier) -> Unit

@Composable
fun LoadedQuestionImage(baseUrl: String, image: QuestionImage, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var attempt by remember(image.imageId, baseUrl) { mutableIntStateOf(0) }
    var verified by remember(baseUrl, attempt) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(baseUrl, attempt) {
        verified = try { OkHttpPostboxProtocolClient(baseUrl).fetchHealth(); true }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { false }
    }
    if (verified != true) {
        Column(modifier) {
            Text(image.alt)
            Text(if (verified == null) "Checking image server" else "Image server unavailable")
            if (verified == false) TextButton(onClick = { attempt++ }) { Text("Retry image") }
        }
        return
    }
    key(attempt) {
        SubcomposeAsyncImage(
            model = ImageRequest.Builder(context).data(questionImageUrl(baseUrl, image)).build(),
            imageLoader = QuestionImages.loader(context), contentDescription = image.alt,
            contentScale = ContentScale.Fit, modifier = modifier,
            loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Loading image", Modifier.semantics { liveRegion = LiveRegionMode.Polite }) } },
            error = { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(image.alt)
                Text("Image unavailable", Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                TextButton(onClick = { attempt++ }) { Text("Retry image") }
            } }
        )
    }
}

@Composable
fun QuestionGallery(
    baseUrl: String,
    images: List<QuestionImage>,
    imageContent: QuestionImageContent = { base, image, modifier -> LoadedQuestionImage(base, image, modifier) }
) {
    if (images.isEmpty()) return
    var selected by rememberSaveable(baseUrl, images.map { it.imageId }) { mutableIntStateOf(-1) }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = if (images.size > 1 && maxWidth >= 360.dp) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            images.chunked(columns).forEachIndexed { rowIndex, row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEachIndexed { columnIndex, image ->
                        val index = rowIndex * columns + columnIndex
                        Column(Modifier.weight(1f)) {
                            Box(Modifier.fillMaxWidth().heightIn(max = 260.dp).aspectRatio(image.width.toFloat() / image.height)
                                .clickable(onClickLabel = "Open image ${index + 1}") { selected = index }) {
                                imageContent(baseUrl, image, Modifier.fillMaxSize())
                            }
                            image.caption?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    if (row.size < columns) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
    if (selected in images.indices) {
        QuestionImageViewer(baseUrl, images, selected, { selected = it }, { selected = -1 }, imageContent)
    }
}

@Composable
private fun QuestionImageViewer(baseUrl: String, images: List<QuestionImage>, selected: Int, onSelect: (Int) -> Unit, onClose: () -> Unit, imageContent: QuestionImageContent) {
    var zoom by rememberSaveable(selected) { mutableFloatStateOf(1f) }
    var x by rememberSaveable(selected) { mutableFloatStateOf(0f) }
    var y by rememberSaveable(selected) { mutableFloatStateOf(0f) }
    fun navigate(delta: Int) { zoom = 1f; x = 0f; y = 0f; onSelect((selected + delta).coerceIn(images.indices)) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BackHandler(onBack = onClose)
        Surface(color = Color.Black, contentColor = Color.White, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onClose) { Text("Close image viewer") }
                    Text("Image ${selected + 1} of ${images.size}", Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                }
                Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()
                    .pointerInput(selected) { detectTapGestures(onDoubleTap = { zoom = if (zoom == 1f) 2.5f else 1f; x = 0f; y = 0f }) }
                    .pointerInput(selected) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            var swipe = Offset.Zero
                            var inspecting = zoom > 1f
                            do {
                                val event = awaitPointerEvent()
                                val pan = event.calculatePan()
                                val factor = event.calculateZoom()
                                if (event.changes.count { it.pressed } > 1) inspecting = true
                                zoom = (zoom * factor).coerceIn(1f, 6f)
                                if (inspecting) {
                                    val limitX = size.width * (zoom - 1f) / 2f
                                    val limitY = size.height * (zoom - 1f) / 2f
                                    x = (x + pan.x).coerceIn(-limitX, limitX)
                                    y = (y + pan.y).coerceIn(-limitY, limitY)
                                } else swipe += pan
                                if (pan.getDistance() > 0f || factor != 1f) event.changes.forEach { it.consume() }
                            } while (event.changes.any { it.pressed })
                            if (!inspecting && kotlin.math.abs(swipe.x) > size.width * .22f && kotlin.math.abs(swipe.x) > kotlin.math.abs(swipe.y)) navigate(if (swipe.x > 0) -1 else 1)
                        }
                    }, contentAlignment = Alignment.Center) {
                    key(selected) { imageContent(baseUrl, images[selected], Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = x; translationY = y }) }
                }
                images[selected].caption?.let { Text(it, Modifier.heightIn(max = 120.dp).verticalScroll(rememberScrollState())) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { navigate(-1) }, enabled = selected > 0) { Text("Previous image") }
                    TextButton(onClick = { zoom = if (zoom == 1f) 2.5f else 1f; x = 0f; y = 0f }) { Text("Zoom ${(zoom * 100).toInt()}%") }
                    TextButton(onClick = { navigate(1) }, enabled = selected < images.lastIndex) { Text("Next image") }
                }
            }
        }
    }
}

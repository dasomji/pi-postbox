package dev.pi.postbox.ui.theme

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.sqrt

/**
 * Ruled letter paper with a red margin line, like a strip torn from a
 * writing pad. Draw order: paper, ruled lines, margin line; content on top.
 */
fun Modifier.letterPaper(): Modifier = drawBehind {
    val ruleSpacing = 24.dp.toPx()
    drawRect(color = PostalColors.elevated)
    var y = ruleSpacing
    while (y < size.height) {
        drawLine(
            color = PostalColors.history.copy(alpha = 0.16f),
            start = Offset(0f, y),
            end = Offset(size.width, y),
            strokeWidth = 1.dp.toPx()
        )
        y += ruleSpacing
    }
    val marginX = 36.dp.toPx()
    drawLine(
        color = PostalColors.attention.copy(alpha = 0.4f),
        start = Offset(marginX, 0f),
        end = Offset(marginX, size.height),
        strokeWidth = 1.dp.toPx()
    )
}

/** Airmail envelope edge: diagonal red/blue stripes on paper. */
fun Modifier.postalStripes(): Modifier = clipToBounds().drawBehind {
    drawRect(color = PostalColors.elevated)
    val stripeWidth = 10.dp.toPx()
    val stepX = stripeWidth * sqrt(2f)
    val colors = listOf(PostalColors.attention, PostalColors.elevated, PostalColors.history, PostalColors.elevated)
    val overshoot = size.height + stripeWidth
    var x = -overshoot
    var stripe = 0
    while (x < size.width + overshoot) {
        drawLine(
            color = colors[stripe % colors.size],
            start = Offset(x, size.height + stripeWidth),
            end = Offset(x + overshoot + stripeWidth, -stripeWidth),
            strokeWidth = stripeWidth
        )
        x += stepX
        stripe += 1
    }
}

/** Dashed rounded border, like the web's border-dashed utility. */
fun Modifier.dashedBorder(color: Color, cornerRadius: Dp, width: Dp = 1.dp): Modifier = drawBehind {
    val strokeWidth = width.toPx()
    val inset = strokeWidth / 2
    drawRoundRect(
        color = color,
        topLeft = Offset(inset, inset),
        size = Size(size.width - strokeWidth, size.height - strokeWidth),
        cornerRadius = CornerRadius(cornerRadius.toPx() - inset),
        style = Stroke(
            width = strokeWidth,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))
        )
    )
}

/** Perforated stamp edge: dashed outline floating just outside the bounds. */
fun Modifier.stampEdge(): Modifier = drawBehind {
    val inset = 2.dp.toPx()
    drawRoundRect(
        color = PostalColors.borderStrong,
        topLeft = Offset(-inset, -inset),
        size = Size(size.width + 2 * inset, size.height + 2 * inset),
        cornerRadius = CornerRadius(3.dp.toPx()),
        style = Stroke(
            width = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))
        )
    )
}

/** Paper plane, matching the web submit button glyph. */
val PaperPlaneIcon: ImageVector = ImageVector.Builder(
    name = "PaperPlane",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f
).apply {
    path(fill = SolidColor(Color.White)) {
        moveTo(2f, 21f)
        lineTo(23f, 12f)
        lineTo(2f, 3f)
        lineTo(2f, 10f)
        lineTo(17f, 12f)
        lineTo(2f, 14f)
        close()
    }
}.build()

/** Envelope outline, matching the web "Why this decision matters" stamp glyph. */
val EnvelopeIcon: ImageVector = ImageVector.Builder(
    name = "Envelope",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f
).apply {
    path(
        stroke = SolidColor(Color.White),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round
    ) {
        moveTo(3f, 5f)
        lineTo(21f, 5f)
        lineTo(21f, 19f)
        lineTo(3f, 19f)
        close()
        moveTo(3f, 7f)
        lineTo(12f, 13f)
        lineTo(21f, 7f)
    }
}.build()

/** Hamburger menu, matching the web mobile navigation toggle. */
val MenuIcon: ImageVector = ImageVector.Builder(
    name = "Menu",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f
).apply {
    path(
        stroke = SolidColor(Color.White),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round
    ) {
        moveTo(4f, 6f)
        lineTo(20f, 6f)
        moveTo(4f, 12f)
        lineTo(20f, 12f)
        moveTo(4f, 18f)
        lineTo(20f, 18f)
    }
}.build()

/** Dismiss cross, matching the web queue row dismiss glyph. */
val CrossIcon: ImageVector = ImageVector.Builder(
    name = "Cross",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f
).apply {
    path(
        stroke = SolidColor(Color.White),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round
    ) {
        moveTo(6f, 6f)
        lineTo(18f, 18f)
        moveTo(18f, 6f)
        lineTo(6f, 18f)
    }
}.build()

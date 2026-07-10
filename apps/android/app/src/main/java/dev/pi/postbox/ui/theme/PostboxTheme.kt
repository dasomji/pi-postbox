package dev.pi.postbox.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Postal light theme, mirroring the web dashboard's design tokens
 * (apps/web/src/styles.css): cream paper canvas, deep navy ink,
 * postal red accents, navy "history" blue, serif display type.
 */
object PostalColors {
    val canvas = Color(0xFFF5EEDE)
    val surface = Color(0xFFFBF6EA)
    val elevated = Color(0xFFFFFDF6)
    val muted = Color(0xFF7A7360)
    val border = Color(0xFFD8CDB3)
    val borderStrong = Color(0xFFBBAD8A)
    val text = Color(0xFF1E2A50)
    val subtle = Color(0xFF424C6E)
    val shadow = Color(0xFF5C4E37)

    val attention = Color(0xFFA8222C)
    val attentionForeground = Color(0xFF8A1C24)
    val attentionContrast = Color(0xFFFFFBF0)
    val attentionBorder = Color(0xFFCD8A8A)

    val history = Color(0xFF2A3C7A)
    val historyForeground = Color(0xFF283668)
    val historyBorder = Color(0xFFA4ACCD)

    val success = Color(0xFF168054)
    val successForeground = Color(0xFF0F6A44)

    val warning = Color(0xFFB0740C)
    val warningForeground = Color(0xFF925E06)

    val danger = Color(0xFFBE283C)
    val dangerForeground = Color(0xFF981E2E)
}

/** Serif stand-in for the web's Iowan Old Style/Palatino/Georgia display stack. */
val PostalDisplayFontFamily = FontFamily.Serif

private val postalColorScheme = lightColorScheme(
    primary = PostalColors.attention,
    onPrimary = PostalColors.attentionContrast,
    primaryContainer = PostalColors.attention.copy(alpha = 0.08f),
    onPrimaryContainer = PostalColors.attentionForeground,
    secondary = PostalColors.history,
    onSecondary = PostalColors.elevated,
    secondaryContainer = PostalColors.history.copy(alpha = 0.08f),
    onSecondaryContainer = PostalColors.historyForeground,
    background = PostalColors.canvas,
    onBackground = PostalColors.text,
    surface = PostalColors.elevated,
    onSurface = PostalColors.text,
    surfaceVariant = PostalColors.surface,
    onSurfaceVariant = PostalColors.subtle,
    outline = PostalColors.borderStrong,
    outlineVariant = PostalColors.border,
    error = PostalColors.danger,
    onError = PostalColors.attentionContrast,
    errorContainer = PostalColors.danger.copy(alpha = 0.1f),
    onErrorContainer = PostalColors.dangerForeground
)

private val postalTypography = Typography().run {
    copy(
        headlineMedium = headlineMedium.copy(fontFamily = PostalDisplayFontFamily, color = PostalColors.text),
        headlineSmall = headlineSmall.copy(fontFamily = PostalDisplayFontFamily, color = PostalColors.text),
        titleLarge = titleLarge.copy(fontFamily = PostalDisplayFontFamily, fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(fontFamily = PostalDisplayFontFamily, fontWeight = FontWeight.SemiBold)
    )
}

/** Small-caps style label, like the web's uppercase tracking-wide captions. */
val PostalCaptionStyle = TextStyle(
    fontSize = 11.sp,
    fontWeight = FontWeight.Bold,
    letterSpacing = 0.08.em,
    color = PostalColors.muted
)

@Composable
fun PostboxTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = postalColorScheme,
        typography = postalTypography,
        content = content
    )
}

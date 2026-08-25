package dev.pi.postbox.protocol

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.pi.postbox.BuildConfig

fun protocolSupportText(): String =
    "Android v${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE}) · supports protocol " +
        GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION

@Composable
fun ProtocolSupportLabel(modifier: Modifier = Modifier) {
    Text(text = protocolSupportText(), style = MaterialTheme.typography.bodySmall, modifier = modifier)
}

@Composable
fun ProtocolMismatchNotice(mismatch: ProtocolMismatch, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Assertive }
            .padding(12.dp)
    ) {
        Text("Protocol mismatch", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
        Text(
            "This Android build supports protocol ${mismatch.supportedVersion}. " +
                "The ${mismatch.source.displayName} uses protocol ${mismatch.receivedVersionLabel}. " +
                "Update Android or the Postbox server so their protocol versions match.",
            style = MaterialTheme.typography.bodyMedium
        )
        ProtocolSupportLabel(modifier = Modifier.padding(top = 8.dp))
    }
}

package dev.pi.postbox.question

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import dev.pi.postbox.protocol.QuestionImage
import org.junit.Rule
import org.junit.Test

class QuestionGalleryTest {
    @get:Rule val compose = createAndroidComposeRule<QuestionTestHostActivity>()
    private val images = listOf(
        QuestionImage("12345678-1234-4123-8123-123456789abc", "image/png", 100, 16, 8, "First screenshot", "Before change"),
        QuestionImage("12345678-1234-4123-8123-123456789abd", "image/webp", 100, 8, 16, "Second screenshot", "After change")
    )
    @Test fun opensNavigatesZoomsAndRestoresPositionWithoutNetwork() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            MaterialTheme {
                QuestionGallery("https://verified.example/", images) { _, image, modifier ->
                    Box(modifier.semantics { contentDescription = image.alt }) { Text("Test image") }
                }
            }
        }
        compose.onNodeWithContentDescription("Second screenshot").performClick()
        compose.onNodeWithText("Image 2 of 2").assertIsDisplayed()
        compose.onNodeWithText("Previous image").performClick()
        compose.onNodeWithText("Image 1 of 2").assertIsDisplayed()
        compose.onNodeWithText("Zoom 100%").performClick()
        compose.onNodeWithText("Zoom 250%").assertIsDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Image 1 of 2").assertIsDisplayed()
        compose.onNodeWithText("Zoom 250%").assertIsDisplayed()
        compose.onNodeWithText("Next image").performClick()
        compose.onNodeWithText("Zoom 100%").assertIsDisplayed()
        compose.onNodeWithText("Close image viewer").performClick()
        compose.onNodeWithText("Image 2 of 2").assertDoesNotExist()
        compose.onNodeWithContentDescription("First screenshot").performClick()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("Close image viewer").assertDoesNotExist()
    }
    @Test fun doubleTapZoomPanAndSwipeUseSeparateGestures() {
        compose.setContent {
            MaterialTheme { QuestionGallery("https://verified.example/", images) { _, image, modifier ->
                Box(modifier.semantics { contentDescription = image.alt }) { Text("Test image") }
            } }
        }
        compose.onNodeWithContentDescription("First screenshot").performClick()
        compose.onAllNodesWithContentDescription("First screenshot").onLast().performTouchInput { doubleClick() }
        compose.onNodeWithText("Zoom 250%").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("First screenshot").onLast().performTouchInput { swipeLeft() }
        compose.onNodeWithText("Image 1 of 2").assertIsDisplayed()
        compose.onNodeWithText("Zoom 250%").performClick()
        compose.onAllNodesWithContentDescription("First screenshot").onLast().performTouchInput { swipeLeft() }
        compose.onNodeWithText("Image 2 of 2").assertIsDisplayed()
    }
}

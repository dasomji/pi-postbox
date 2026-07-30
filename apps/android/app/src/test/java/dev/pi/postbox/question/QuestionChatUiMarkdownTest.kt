package dev.pi.postbox.question

import androidx.compose.ui.text.LinkAnnotation
import dev.pi.postbox.questionchat.SafeMarkdownInline
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionChatUiMarkdownTest {
    @Test
    fun markdownAnnotatedStringUsesLinkAnnotationsAndDeliversClicks() {
        var clickedUrl: String? = null

        val annotated = buildQuestionChatMarkdownAnnotatedString(
            inlines = listOf(
                SafeMarkdownInline.Text("Read "),
                SafeMarkdownInline.Link(
                    children = listOf(SafeMarkdownInline.Text("Android docs")),
                    url = "https://developer.android.com/"
                ),
                SafeMarkdownInline.Text(" first.")
            ),
            onLinkClick = { clickedUrl = it }
        )

        assertTrue(annotated.hasLinkAnnotations(0, annotated.length))
        assertTrue(annotated.getStringAnnotations(0, annotated.length).isEmpty())

        val annotation = annotated.getLinkAnnotations(0, annotated.length).single().item as LinkAnnotation.Url
        annotation.linkInteractionListener?.onClick(annotation)

        assertEquals("https://developer.android.com/", clickedUrl)
    }

    @Test
    fun markdownAnnotatedStringKeepsUnsafeLinksInert() {
        val annotated = buildQuestionChatMarkdownAnnotatedString(
            inlines = listOf(
                SafeMarkdownInline.Link(
                    children = listOf(SafeMarkdownInline.Text("bad")),
                    url = "javascript:alert('xss')"
                )
            ),
            onLinkClick = {}
        )

        assertFalse(annotated.hasLinkAnnotations(0, annotated.length))
    }
}

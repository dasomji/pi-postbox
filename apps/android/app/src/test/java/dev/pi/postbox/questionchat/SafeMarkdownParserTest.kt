package dev.pi.postbox.questionchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeMarkdownParserTest {
    private val parser = SafeMarkdownParser()

    @Test
    fun parsesParagraphsHeadingsListsAndSafeLinks() {
        val result = parser.parse("# Heading\n\nParagraph with [safe](https://example.com/path).\n\n- one\n- two")
        val document = (result as SafeMarkdownRenderResult.Rich).document

        assertEquals(3, document.blocks.size)
        assertTrue(document.blocks[0] is SafeMarkdownBlock.Heading)
        assertTrue(document.blocks[1] is SafeMarkdownBlock.Paragraph)
        assertTrue(document.blocks[2] is SafeMarkdownBlock.ListBlock)
        val paragraph = document.blocks[1] as SafeMarkdownBlock.Paragraph
        assertTrue(paragraph.inlines.any { it is SafeMarkdownInline.Link && it.url == "https://example.com/path" })
    }

    @Test
    fun turnsUnsafeLinksIntoPlainTextAndImagesIntoOmittedText() {
        val result = parser.parse("[bad](javascript:alert(1)) ![diagram](https://example.com/diagram.png)")
        val paragraph = ((result as SafeMarkdownRenderResult.Rich).document.blocks.single() as SafeMarkdownBlock.Paragraph)

        assertFalse(paragraph.inlines.any { it is SafeMarkdownInline.Link })
        assertTrue(paragraph.plainText().contains("bad"))
        assertTrue(paragraph.plainText().contains("Image omitted: diagram"))
    }

    @Test
    fun fallsBackToBoundedPlainTextWhenSourceExceedsLimit() {
        val oversized = "x".repeat(SafeMarkdownLimits.SOURCE_MAX_CHARS + 1)

        val result = parser.parse(oversized)

        val fallback = result as SafeMarkdownRenderResult.PlainTextFallback
        assertEquals(SafeMarkdownLimits.SOURCE_MAX_CHARS, fallback.text.length)
        assertTrue(fallback.formattingUnavailable)
    }
}

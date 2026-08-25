package dev.pi.postbox.questionchat

import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Document
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListBlock
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser

object SafeMarkdownLimits {
    const val SOURCE_MAX_CHARS = 32_000
    const val NODE_MAX = 4_096
    const val BLOCK_MAX = 512
    const val LIST_NESTING_MAX = 8
    const val CODE_BLOCK_MAX_CHARS = 16_000
    const val LINK_DESTINATION_MAX_CHARS = 2_048
    const val MAX_OPEN_BLOCK_PARSERS = 32
}

sealed interface SafeMarkdownRenderResult {
    data class Rich(val document: SafeMarkdownDocument) : SafeMarkdownRenderResult
    data class PlainTextFallback(
        val text: String,
        val formattingUnavailable: Boolean
    ) : SafeMarkdownRenderResult
}

data class SafeMarkdownDocument(
    val blocks: List<SafeMarkdownBlock>
)

sealed interface SafeMarkdownBlock {
    data class Paragraph(val inlines: List<SafeMarkdownInline>) : SafeMarkdownBlock
    data class Heading(val level: Int, val inlines: List<SafeMarkdownInline>) : SafeMarkdownBlock
    data class Quote(val blocks: List<SafeMarkdownBlock>) : SafeMarkdownBlock
    data class ListBlock(
        val ordered: Boolean,
        val startNumber: Int?,
        val items: List<List<SafeMarkdownBlock>>
    ) : SafeMarkdownBlock
    data class CodeBlock(
        val text: String,
        val language: String?,
        val truncated: Boolean
    ) : SafeMarkdownBlock
    data object ThematicBreak : SafeMarkdownBlock
}

sealed interface SafeMarkdownInline {
    data class Text(val text: String) : SafeMarkdownInline
    data class Emphasis(val children: List<SafeMarkdownInline>) : SafeMarkdownInline
    data class Strong(val children: List<SafeMarkdownInline>) : SafeMarkdownInline
    data class Code(val text: String) : SafeMarkdownInline
    data class Link(val children: List<SafeMarkdownInline>, val url: String) : SafeMarkdownInline
}

open class SafeMarkdownParser {
    private val parser = Parser.builder()
        .maxOpenBlockParsers(SafeMarkdownLimits.MAX_OPEN_BLOCK_PARSERS)
        .build()

    open fun parse(source: String): SafeMarkdownRenderResult {
        val boundedSource = source.take(SafeMarkdownLimits.SOURCE_MAX_CHARS)
        if (source.length > SafeMarkdownLimits.SOURCE_MAX_CHARS) {
            return SafeMarkdownRenderResult.PlainTextFallback(
                text = boundedSource,
                formattingUnavailable = true
            )
        }
        return try {
            val node = parser.parse(boundedSource)
            val context = ConversionContext()
            val blocks = context.convertBlocks(node, 0).take(SafeMarkdownLimits.BLOCK_MAX)
            SafeMarkdownRenderResult.Rich(SafeMarkdownDocument(blocks = blocks))
        } catch (_: Exception) {
            SafeMarkdownRenderResult.PlainTextFallback(
                text = boundedSource,
                formattingUnavailable = true
            )
        }
    }
}

private class ConversionContext {
    private var nodesSeen = 0

    fun convertBlocks(parent: Node, listDepth: Int): List<SafeMarkdownBlock> {
        val blocks = mutableListOf<SafeMarkdownBlock>()
        var child = parent.firstChild
        while (child != null && blocks.size < SafeMarkdownLimits.BLOCK_MAX) {
            visit(child)
            when (child) {
                is Paragraph -> blocks += SafeMarkdownBlock.Paragraph(convertInlines(child))
                is Heading -> blocks += SafeMarkdownBlock.Heading(child.level, convertInlines(child))
                is BlockQuote -> blocks += SafeMarkdownBlock.Quote(convertBlocks(child, listDepth))
                is BulletList -> blocks += convertList(child, listDepth, ordered = false, startNumber = null)
                is OrderedList -> blocks += convertList(child, listDepth, ordered = true, startNumber = child.startNumber)
                is FencedCodeBlock -> blocks += convertCodeBlock(child.literal, child.info)
                is IndentedCodeBlock -> blocks += convertCodeBlock(child.literal, null)
                is ThematicBreak -> blocks += SafeMarkdownBlock.ThematicBreak
                is HtmlBlock -> blocks += SafeMarkdownBlock.Paragraph(listOf(SafeMarkdownInline.Text(child.literal.orEmpty())))
            }
            child = child.next
        }
        return blocks
    }

    private fun convertList(node: ListBlock, listDepth: Int, ordered: Boolean, startNumber: Int?): SafeMarkdownBlock.ListBlock {
        val items = mutableListOf<List<SafeMarkdownBlock>>()
        var child = node.firstChild
        while (child != null) {
            visit(child)
            if (child is ListItem) {
                items += if (listDepth + 1 >= SafeMarkdownLimits.LIST_NESTING_MAX) {
                    listOf(SafeMarkdownBlock.Paragraph(listOf(SafeMarkdownInline.Text(flattenText(child)))))
                } else {
                    convertBlocks(child, listDepth + 1)
                }
            }
            child = child.next
        }
        return SafeMarkdownBlock.ListBlock(
            ordered = ordered,
            startNumber = startNumber,
            items = items
        )
    }

    private fun convertCodeBlock(text: String?, language: String?): SafeMarkdownBlock.CodeBlock {
        val bounded = (text ?: "").take(SafeMarkdownLimits.CODE_BLOCK_MAX_CHARS)
        return SafeMarkdownBlock.CodeBlock(
            text = bounded,
            language = language?.trim().orEmpty().ifBlank { null },
            truncated = bounded.length < (text ?: "").length
        )
    }

    private fun convertInlines(parent: Node): List<SafeMarkdownInline> {
        val inlines = mutableListOf<SafeMarkdownInline>()
        var child = parent.firstChild
        while (child != null) {
            visit(child)
            when (child) {
                is Text -> inlines += SafeMarkdownInline.Text(child.literal)
                is SoftLineBreak, is HardLineBreak -> inlines += SafeMarkdownInline.Text("\n")
                is Emphasis -> inlines += SafeMarkdownInline.Emphasis(convertInlines(child))
                is StrongEmphasis -> inlines += SafeMarkdownInline.Strong(convertInlines(child))
                is Code -> inlines += SafeMarkdownInline.Code(child.literal)
                is Link -> {
                    val children = convertInlines(child)
                    val safeUrl = child.destination?.take(SafeMarkdownLimits.LINK_DESTINATION_MAX_CHARS)?.takeIf(::isSafeHttpUrl)
                    if (safeUrl == null) inlines += children
                    else inlines += SafeMarkdownInline.Link(children = children, url = safeUrl)
                }
                is Image -> {
                    val alt = flattenText(child).ifBlank { "image" }
                    inlines += SafeMarkdownInline.Text("Image omitted: $alt")
                }
                is HtmlInline -> inlines += SafeMarkdownInline.Text(child.literal.orEmpty())
                else -> if (child.firstChild != null) inlines += convertInlines(child)
            }
            child = child.next
        }
        return mergeAdjacentText(inlines)
    }

    private fun mergeAdjacentText(inlines: List<SafeMarkdownInline>): List<SafeMarkdownInline> {
        if (inlines.isEmpty()) return listOf(SafeMarkdownInline.Text(""))
        val merged = mutableListOf<SafeMarkdownInline>()
        inlines.forEach { inline ->
            val previous = merged.lastOrNull()
            if (previous is SafeMarkdownInline.Text && inline is SafeMarkdownInline.Text) {
                merged[merged.lastIndex] = SafeMarkdownInline.Text(previous.text + inline.text)
            } else {
                merged += inline
            }
        }
        return merged
    }

    private fun flattenText(parent: Node): String {
        val builder = StringBuilder()
        var child = parent.firstChild
        while (child != null) {
            when (child) {
                is Text -> builder.append(child.literal)
                is Code -> builder.append(child.literal)
                is SoftLineBreak, is HardLineBreak -> builder.append('\n')
                is HtmlInline -> builder.append(child.literal.orEmpty())
                else -> if (child.firstChild != null) builder.append(flattenText(child))
            }
            child = child.next
        }
        return builder.toString()
    }

    private fun visit(node: Node) {
        nodesSeen += 1
        if (nodesSeen > SafeMarkdownLimits.NODE_MAX) {
            throw IllegalStateException("Markdown node limit exceeded")
        }
    }
}

private fun isSafeHttpUrl(value: String): Boolean {
    if (value.length > SafeMarkdownLimits.LINK_DESTINATION_MAX_CHARS) return false
    return try {
        val uri = java.net.URI(value)
        val scheme = uri.scheme?.lowercase() ?: return false
        (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
    } catch (_: Exception) {
        false
    }
}

fun SafeMarkdownBlock.plainText(): String = when (this) {
    is SafeMarkdownBlock.Paragraph -> inlines.joinToString(separator = "") { it.plainText() }
    is SafeMarkdownBlock.Heading -> inlines.joinToString(separator = "") { it.plainText() }
    is SafeMarkdownBlock.Quote -> blocks.joinToString(separator = "\n") { it.plainText() }
    is SafeMarkdownBlock.ListBlock -> items.flatten().joinToString(separator = "\n") { it.plainText() }
    is SafeMarkdownBlock.CodeBlock -> text
    SafeMarkdownBlock.ThematicBreak -> ""
}

fun SafeMarkdownInline.plainText(): String = when (this) {
    is SafeMarkdownInline.Text -> text
    is SafeMarkdownInline.Emphasis -> children.joinToString(separator = "") { it.plainText() }
    is SafeMarkdownInline.Strong -> children.joinToString(separator = "") { it.plainText() }
    is SafeMarkdownInline.Code -> text
    is SafeMarkdownInline.Link -> children.joinToString(separator = "") { it.plainText() }
}

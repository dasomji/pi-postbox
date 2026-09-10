package dev.pi.postbox.question

import dev.pi.postbox.protocol.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class QuestionImagesTest {
    @Test fun `shared fixture preserves gallery order descriptions and omitted defaults`() {
        val contract = javaClass.classLoader!!.getResourceAsStream("contract.json")!!.bufferedReader().use { PostboxProtocolJson.json.parseToJsonElement(it.readText()).jsonObject }
        val state = PostboxProtocolJson.decodeStateSnapshot(contract["fixtures"]!!.jsonObject["states"]!!.jsonArray.first().toString())
        val gallery = state.requests.first().images
        assertEquals(listOf("Contract screenshot", "Second evidence"), gallery.map { it.alt })
        assertEquals("First evidence", gallery.first().caption)
        assertTrue(state.requests.drop(1).all { it.images.isEmpty() })
        assertEquals("https://verified.example/media/images/${gallery.first().imageId}", questionImageUrl("https://verified.example/", gallery.first()))
        assertEquals("https://new.example/media/images/${gallery.first().imageId}", questionImageUrl("https://new.example/", gallery.first()))
    }
    @Test fun `malformed metadata cannot introduce arbitrary media paths or decode sizes`() {
        assertThrows(IllegalArgumentException::class.java) { QuestionImage("../private", "image/png", 1, 1, 1, "Alt") }
        assertThrows(IllegalArgumentException::class.java) { QuestionImage("12345678-1234-4123-8123-123456789abc", "image/png", 1, 8192, 8192, "Alt") }
    }
}

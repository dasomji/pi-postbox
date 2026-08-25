package dev.pi.postbox.protocol

import dev.pi.postbox.push.PostboxPushDecision
import dev.pi.postbox.push.decodePostboxPushData
import dev.pi.postbox.questionchat.QuestionChatAvailabilityCode
import dev.pi.postbox.questionchat.QuestionChatState
import dev.pi.postbox.questionchat.parseActivationResponse
import dev.pi.postbox.questionchat.parseJsonObject
import dev.pi.postbox.questionchat.parseQuestionChatStreamEvent
import dev.pi.postbox.questionchat.parseSendResponse
import dev.pi.postbox.questionchat.parseSnapshotEnvelope
import dev.pi.postbox.questionchat.parseStopResponse
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GeneratedProtocolConformanceTest {
    private val contract: JsonObject = requireNotNull(javaClass.classLoader?.getResourceAsStream("contract.json")) {
        "Generated Android protocol contract resource is missing"
    }.bufferedReader().use { PostboxProtocolJson.json.parseToJsonElement(it.readText()).jsonObject }
    private val gate = ProtocolCompatibilityGate()

    @Test
    fun `generated identity and exhaustive Kotlin wire mappings match`() {
        assertEquals(GeneratedPostboxProtocolContract.SUPPORTED_PROTOCOL_VERSION, contract.requiredString("protocolVersion"))
        assertEquals(GeneratedPostboxProtocolContract.CONTRACT_FINGERPRINT, contract.requiredString("fingerprint"))

        val wire = contract.requiredObject("wireValues")
        assertEquals(GeneratedPostboxProtocolContract.SEMANTIC_STATES, wire.strings("semanticStates"))
        assertEquals(GeneratedPostboxProtocolContract.PRESENCE_STATES, wire.strings("presenceStates"))
        assertEquals(GeneratedPostboxProtocolContract.ASK_STATUSES, wire.strings("askStatuses"))
        assertEquals(GeneratedPostboxProtocolContract.SEMANTIC_STATES, SemanticState.entries.map { it.wireValue })
        assertEquals(GeneratedPostboxProtocolContract.PRESENCE_STATES, PresenceState.entries.map { encodeWire(PresenceState.serializer(), it) })
        assertEquals(GeneratedPostboxProtocolContract.ASK_MODES, AskMode.entries.map { encodeWire(AskMode.serializer(), it) })
        assertEquals(GeneratedPostboxProtocolContract.ASK_STATUSES, AskStatus.entries.map { encodeWire(AskStatus.serializer(), it) })
        assertEquals(GeneratedPostboxProtocolContract.ASK_RESULT_STATUSES, AskResultStatus.entries.map { encodeWire(AskResultStatus.serializer(), it) })
        assertEquals(GeneratedPostboxProtocolContract.ASK_OPTION_PROVENANCES, AskOptionProvenance.entries.map { encodeWire(AskOptionProvenance.serializer(), it) })
        GeneratedPostboxProtocolContract.QUESTION_CHAT_STATES.forEach(QuestionChatState::fromWire)
        GeneratedPostboxProtocolContract.QUESTION_CHAT_AVAILABILITY_CODES.forEach(QuestionChatAvailabilityCode::fromWire)
        GeneratedPostboxProtocolContract.QUESTION_CHAT_MODEL_SOURCES.forEach(dev.pi.postbox.questionchat.QuestionChatModelSource::fromWire)
        GeneratedPostboxProtocolContract.QUESTION_CHAT_SEND_MODES.forEach(dev.pi.postbox.questionchat.QuestionChatSendMode::fromWire)
    }

    @Test
    fun `Android decodes every generated current envelope through production gates`() {
        val fixtures = contract.requiredObject("fixtures")
        gate.decodeVersioned(fixtures.requiredObject("health").toString(), ProtocolMessageSource.HEALTH) { raw ->
            PostboxProtocolJson.json.decodeFromString(HealthResponse.serializer(), raw)
        }
        fixtures.requiredArray("states").forEach { value ->
            gate.decodeVersioned(value.toString(), ProtocolMessageSource.STATE_HTTP, PostboxProtocolJson::decodeStateSnapshot)
        }
        fixtures.requiredArray("questionChatHttp").forEach { value ->
            val fixture = value.jsonObject
            val kind = fixture.requiredString("kind")
            gate.decodeVersioned(fixture.requiredObject("payload").toString(), ProtocolMessageSource.QUESTION_CHAT_HTTP) { raw ->
                val body = parseJsonObject(raw)
                when {
                    kind.startsWith("activation") -> parseActivationResponse(body)
                    kind.startsWith("snapshot") -> parseSnapshotEnvelope(body)
                    kind.startsWith("send") -> parseSendResponse(body)
                    else -> parseStopResponse(body)
                }
            }
        }
        fixtures.requiredArray("questionChatAvailability").forEach { value ->
            gate.decodeVersioned(value.toString(), ProtocolMessageSource.QUESTION_CHAT_HTTP) { raw ->
                parseActivationResponse(parseJsonObject(raw))
            }
        }
        fixtures.requiredArray("questionChatEvents").forEach { value ->
            gate.decodeVersioned(value.toString(), ProtocolMessageSource.QUESTION_CHAT_STREAM) { raw ->
                parseQuestionChatStreamEvent(parseJsonObject(raw))
            }
        }
        fixtures.requiredArray("fcm").forEach { value ->
            val map = value.jsonObject.mapValues { (_, item) -> item.jsonPrimitive.content }
            when (value.jsonObject.requiredString("type")) {
                "ask.created" -> assertTrue(decodePostboxPushData(map) is PostboxPushDecision.Created)
                "ask.resolved" -> assertTrue(decodePostboxPushData(map) is PostboxPushDecision.Resolved)
                else -> error("Generated FCM branch has no Android assertion")
            }
        }
        fixtures.requiredArray("answerCancel").forEach { value ->
            val fixture = value.jsonObject
            gate.decodeVersioned(fixture.requiredObject("payload").toString(), ProtocolMessageSource.STATE_HTTP) { raw ->
                val body = PostboxProtocolJson.json.parseToJsonElement(raw).jsonObject
                body["result"]?.let { PostboxProtocolJson.json.decodeFromJsonElement(AskResult.serializer(), it) }
                    ?: checkNotNull(PostboxErrorResponse.parse(raw))
            }
        }
    }

    @Test
    fun `matching version remains tolerant of unknown object fields`() {
        val state = contract.requiredObject("fixtures").requiredArray("states").first().jsonObject.toMutableMap()
        state["futureField"] = JsonPrimitive("ignored")
        val decoded = gate.decodeVersioned(JsonObject(state).toString(), ProtocolMessageSource.STATE_HTTP, PostboxProtocolJson::decodeStateSnapshot)
        assertTrue(decoded.sessions.isNotEmpty())
    }

    @Test
    fun `generated fixtures exhaust every schema-derived consumed wire value`() {
        val fixtures = contract.requiredObject("fixtures")
        val states = fixtures.requiredArray("states").map { it.jsonObject }
        assertEquals(
            GeneratedPostboxProtocolContract.SEMANTIC_STATES.toSet(),
            states.flatMap { it.requiredArray("sessions") }.map { it.jsonObject.requiredString("semanticState") }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.PRESENCE_STATES.toSet(),
            states.flatMap { it.requiredArray("sessions") }.map { it.jsonObject.requiredString("presence") }.toSet()
        )
        val requests = states.flatMap { it.requiredArray("requests").map { request -> request.jsonObject } }
        assertEquals(GeneratedPostboxProtocolContract.ASK_MODES.toSet(), requests.map { it.requiredString("mode") }.toSet())
        assertEquals(GeneratedPostboxProtocolContract.ASK_STATUSES.toSet(), requests.map { it.requiredString("status") }.toSet())
        assertEquals(
            GeneratedPostboxProtocolContract.ASK_OPTION_PROVENANCES.toSet(),
            requests.flatMap { it.requiredArray("options") }.mapNotNull { it.jsonObject["provenance"]?.jsonPrimitive?.contentOrNull }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.FCM_TYPES.toSet(),
            fixtures.requiredArray("fcm").map { it.jsonObject.requiredString("type") }.toSet()
        )

        val results = fixtures.requiredArray("answerCancel").mapNotNull { fixture ->
            fixture.jsonObject.requiredObject("payload")["result"]?.jsonObject?.requiredString("status")
        }
        assertEquals(GeneratedPostboxProtocolContract.ASK_RESULT_STATUSES.toSet(), results.toSet())
        val availability = fixtures.requiredArray("questionChatAvailability").map {
            it.jsonObject.requiredObject("error").requiredString("code")
        }
        assertEquals(GeneratedPostboxProtocolContract.QUESTION_CHAT_AVAILABILITY_CODES.toSet(), availability.toSet())

        val chatHttp = fixtures.requiredArray("questionChatHttp").map { it.jsonObject.requiredObject("payload") }
        val snapshots = chatHttp.mapNotNull { it["snapshot"]?.jsonObject }
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_MODEL_SOURCES.toSet(),
            snapshots.map { it.requiredObject("model").requiredString("source") }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_SEND_MODES.toSet(),
            chatHttp.mapNotNull { it["mode"]?.jsonPrimitive?.contentOrNull }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_ASSISTANT_STATUSES.toSet(),
            snapshots.flatMap { it.requiredArray("messages") }
                .map { it.jsonObject }
                .filter { it.requiredString("role") == "assistant" }
                .map { it.requiredString("status") }
                .toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_TOOL_NAMES.toSet(),
            fixtures.requiredArray("questionChatEvents").mapNotNull { it.jsonObject["activity"]?.jsonObject?.get("tool")?.jsonPrimitive?.contentOrNull }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_TOOL_STATES.toSet(),
            snapshots.flatMap { it.requiredArray("tools") }.map { it.jsonObject.requiredString("state") }.toSet()
        )
        assertEquals(
            GeneratedPostboxProtocolContract.QUESTION_CHAT_EVENT_TYPES.toSet(),
            fixtures.requiredArray("questionChatEvents").map { it.jsonObject.requiredString("type") }.toSet()
        )
    }

    private fun <T> encodeWire(serializer: kotlinx.serialization.KSerializer<T>, value: T): String =
        PostboxProtocolJson.json.encodeToString(serializer, value).trim('"')
}

private fun JsonObject.requiredString(name: String): String =
    this[name]?.jsonPrimitive?.contentOrNull ?: error("Missing $name")

private fun JsonObject.requiredObject(name: String): JsonObject =
    this[name]?.jsonObject ?: error("Missing $name")

private fun JsonObject.requiredArray(name: String): JsonArray =
    this[name]?.jsonArray ?: error("Missing $name")

private fun JsonObject.strings(name: String): List<String> =
    requiredArray(name).map { it.jsonPrimitive.content }

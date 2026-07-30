package dev.pi.postbox.question

const val MAX_QUESTION_DRAFT_SELECTED_VALUES = 20
const val MAX_QUESTION_DRAFT_VALUE_CHARS = 200
const val MAX_QUESTION_DRAFT_NOTE_CHARS = 128_000

/** Stable identity for one local Question answer draft. The server URL must already be normalized. */
data class QuestionDraftKey(
    val normalizedServerUrl: String,
    val requestId: String
)

/** The complete durable Question answer draft. Question Chat data is intentionally not representable here. */
data class QuestionAnswerDraft(
    val selectedValues: List<String> = emptyList(),
    val note: String = ""
)

enum class QuestionDraftStoreFailure {
    KEY_INVALIDATED,
    CORRUPT,
    READ_FAILED,
    WRITE_FAILED
}

sealed interface QuestionDraftStoreResult<out T> {
    data class Success<T>(val value: T) : QuestionDraftStoreResult<T>
    data class Failure(val reason: QuestionDraftStoreFailure) : QuestionDraftStoreResult<Nothing>
}

interface QuestionDraftStore {
    suspend fun load(key: QuestionDraftKey): QuestionDraftStoreResult<QuestionAnswerDraft?>

    suspend fun save(
        key: QuestionDraftKey,
        draft: QuestionAnswerDraft
    ): QuestionDraftStoreResult<Unit>

    suspend fun delete(key: QuestionDraftKey): QuestionDraftStoreResult<Unit>

    suspend fun reconcileServer(
        normalizedServerUrl: String,
        activeRequestIds: Set<String>
    ): QuestionDraftStoreResult<Unit>
}

object NoopQuestionDraftStore : QuestionDraftStore {
    override suspend fun load(key: QuestionDraftKey) =
        QuestionDraftStoreResult.Success<QuestionAnswerDraft?>(null)

    override suspend fun save(key: QuestionDraftKey, draft: QuestionAnswerDraft) =
        QuestionDraftStoreResult.Success(Unit)

    override suspend fun delete(key: QuestionDraftKey) = QuestionDraftStoreResult.Success(Unit)

    override suspend fun reconcileServer(normalizedServerUrl: String, activeRequestIds: Set<String>) =
        QuestionDraftStoreResult.Success(Unit)
}

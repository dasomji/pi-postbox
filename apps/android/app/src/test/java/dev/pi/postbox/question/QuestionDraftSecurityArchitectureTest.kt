package dev.pi.postbox.question

import java.io.File
import java.lang.reflect.Modifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionDraftSecurityArchitectureTest {
    @Test
    fun persistedPayloadStructurallyContainsOnlyAnswerSelectionsAndNote() {
        val payloadFields = QuestionAnswerDraft::class.java.declaredFields
            .filterNot { field -> field.isSynthetic || Modifier.isStatic(field.modifiers) }
            .map { field -> field.name }
            .toSet()

        assertEquals(setOf("selectedValues", "note"), payloadFields)

        val adapterSource = appSource(
            "src/main/java/dev/pi/postbox/question/AndroidKeystoreQuestionDraftStore.kt"
        ).readText()
        listOf(
            "questionContext",
            "relevance",
            "decisionImpact",
            "handoffContext",
            "forkReference",
            "transcript",
            "composer",
            "command",
            "tool",
            "snapshot",
            "chatMessage",
            "chatMessages"
        ).forEach { forbiddenChatField ->
            assertFalse(
                "$forbiddenChatField must not enter the draft persistence sink",
                adapterSource.contains(forbiddenChatField, ignoreCase = true)
            )
        }
    }

    @Test
    fun draftStoreReferencesStayInsideQuestionOwnerAndCompositionRoot() {
        val sourceRoot = appSource("src/main/java")
        val references = sourceRoot.walkTopDown()
            .filter { file -> file.isFile && file.extension == "kt" }
            .filter { file -> file.readText().contains("QuestionDraftStore") }
            .map { file -> file.relativeTo(sourceRoot).invariantSeparatorsPath }
            .toList()

        assertTrue(references.isNotEmpty())
        references.forEach { relativePath ->
            assertTrue(
                "$relativePath must not access the Question-owned draft store",
                relativePath == "dev/pi/postbox/MainActivity.kt" ||
                    relativePath.startsWith("dev/pi/postbox/question/")
            )
        }
    }

    @Test
    fun productionWorkflowUsesOneRememberedEncryptedDraftStore() {
        val mainActivitySource = appSource("src/main/java/dev/pi/postbox/MainActivity.kt").readText()

        assertTrue(
            mainActivitySource.contains(
                "val questionDraftStore = remember(appContext) {\n" +
                    "        AndroidKeystoreQuestionDraftStore(appContext)\n" +
                    "    }"
            )
        )
        assertTrue(
            Regex("draftStore\\s*=\\s*questionDraftStore")
                .containsMatchIn(mainActivitySource)
        )
    }

    private fun appSource(relativePath: String): File = File(findAppDirectory(), relativePath)

    private fun findAppDirectory(): File {
        val workingDirectory = requireNotNull(System.getProperty("user.dir"))
        var directory: File? = File(workingDirectory).canonicalFile
        while (directory != null) {
            listOf(directory, File(directory, "app")).firstOrNull { candidate ->
                File(candidate, "src/main/AndroidManifest.xml").isFile
            }?.let { return it }
            directory = directory.parentFile
        }
        error("Could not locate Android app directory from $workingDirectory")
    }
}

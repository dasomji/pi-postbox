package dev.pi.postbox.question

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

class QuestionDraftBackupRulesTest {
    @Test
    fun manifestAndBothBackupRuleFormatsExplicitlyExcludeQuestionDrafts() {
        val appDirectory = findAppDirectory()
        val manifest = parseXml(File(appDirectory, "src/main/AndroidManifest.xml"))
        val application = manifest.documentElement
            .getElementsByTagName("application")
            .item(0) as Element

        assertEquals(
            "@xml/backup_rules",
            application.getAttributeNS(ANDROID_NAMESPACE, "fullBackupContent")
        )
        assertEquals(
            "@xml/data_extraction_rules",
            application.getAttributeNS(ANDROID_NAMESPACE, "dataExtractionRules")
        )

        val legacyRules = parseXml(File(appDirectory, "src/main/res/xml/backup_rules.xml"))
        assertEquals("full-backup-content", legacyRules.documentElement.tagName)
        assertHasDraftExclusion(legacyRules.documentElement, expectedCount = 1)

        val modernRules = parseXml(File(appDirectory, "src/main/res/xml/data_extraction_rules.xml"))
        assertEquals("data-extraction-rules", modernRules.documentElement.tagName)
        assertEquals(1, modernRules.documentElement.getElementsByTagName("cloud-backup").length)
        assertEquals(1, modernRules.documentElement.getElementsByTagName("device-transfer").length)
        assertHasDraftExclusion(modernRules.documentElement, expectedCount = 2)
    }

    private fun assertHasDraftExclusion(root: Element, expectedCount: Int) {
        val exclusions = root.getElementsByTagName("exclude")
        val matching = (0 until exclusions.length)
            .map { exclusions.item(it) as Element }
            .count { exclusion ->
                exclusion.getAttribute("domain") == "root" &&
                    exclusion.getAttribute("path") == DRAFT_BACKUP_PATH
            }
        assertEquals(expectedCount, matching)
    }

    private fun parseXml(file: File) = DocumentBuilderFactory.newInstance()
        .apply { isNamespaceAware = true }
        .newDocumentBuilder()
        .parse(file)

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

    private companion object {
        const val ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
        const val DRAFT_BACKUP_PATH = "no_backup/question_drafts_v1"
    }
}

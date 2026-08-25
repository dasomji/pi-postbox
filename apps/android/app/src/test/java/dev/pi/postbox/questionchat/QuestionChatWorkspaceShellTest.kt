package dev.pi.postbox.questionchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionChatWorkspaceShellTest {
    @Test
    fun bindShowsTabsBeforeActivationAndDefaultsToQuestion() {
        val shell = QuestionChatWorkspaceShell()

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-1"))

        assertTrue(shell.state.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertFalse(shell.state.runtimeReady)
    }

    @Test
    fun discoveryKeepsTabsVisibleAndQuestionSelected() {
        val shell = QuestionChatWorkspaceShell()

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-1"))
        shell.onRecoveredRuntimeDiscovered()

        assertTrue(shell.state.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertTrue(shell.state.runtimeReady)
    }

    @Test
    fun activationSuccessKeepsTabsVisibleAndSelectsChat() {
        val shell = QuestionChatWorkspaceShell()

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-1"))
        shell.onActivatedRuntimeReady()

        assertTrue(shell.state.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.CHAT, shell.state.selectedTab)
        assertTrue(shell.state.runtimeReady)
    }

    @Test
    fun sameKeyPreservesSelectedTabButNewKeyResetsToVisibleQuestionTab() {
        val key = QuestionChatBindingKey("https://postbox.example/", "ask-1")
        val shell = QuestionChatWorkspaceShell()

        shell.bind(key)
        shell.onActivatedRuntimeReady()
        shell.selectTab(QuestionChatWorkspaceTab.QUESTION)
        shell.bind(key)

        assertTrue(shell.state.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertTrue(shell.state.runtimeReady)

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-2"))

        assertTrue(shell.state.tabsVisible)
        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertFalse(shell.state.runtimeReady)
    }

    @Test
    fun backFromChatReturnsToQuestionAndRequestsStableFocus() {
        val shell = QuestionChatWorkspaceShell()

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-1"))
        shell.onActivatedRuntimeReady()

        assertTrue(shell.handleBack())
        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertTrue(shell.state.questionFocusToken > 0)
        assertFalse(shell.handleBack())
    }

    @Test
    fun reviewSuggestedOptionSelectsQuestionAndAdvancesReviewHighlightToken() {
        val shell = QuestionChatWorkspaceShell()

        shell.bind(QuestionChatBindingKey("https://postbox.example/", "ask-1"))
        shell.onActivatedRuntimeReady()
        shell.reviewSuggestedOption("ship")

        assertEquals(QuestionChatWorkspaceTab.QUESTION, shell.state.selectedTab)
        assertEquals("ship", shell.state.suggestedOptionReview?.optionValue)
        assertTrue((shell.state.suggestedOptionReview?.token ?: 0L) > 0L)
        assertTrue(shell.state.questionFocusToken > 0L)
    }
}

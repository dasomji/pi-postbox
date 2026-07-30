package dev.pi.postbox.questionchat

enum class QuestionChatWorkspaceTab {
    QUESTION,
    CHAT
}

data class QuestionChatWorkspaceShellState(
    val key: QuestionChatBindingKey? = null,
    val tabsVisible: Boolean = false,
    val selectedTab: QuestionChatWorkspaceTab = QuestionChatWorkspaceTab.QUESTION,
    val questionFocusToken: Long = 0L
)

class QuestionChatWorkspaceShell {
    var state: QuestionChatWorkspaceShellState = QuestionChatWorkspaceShellState()
        private set

    fun bind(key: QuestionChatBindingKey?) {
        if (state.key == key) return
        state = QuestionChatWorkspaceShellState(key = key)
    }

    fun onRecoveredRuntimeDiscovered() {
        if (state.key == null) return
        state = state.copy(tabsVisible = true, selectedTab = QuestionChatWorkspaceTab.QUESTION)
    }

    fun onActivatedRuntimeReady() {
        if (state.key == null) return
        state = state.copy(tabsVisible = true, selectedTab = QuestionChatWorkspaceTab.CHAT)
    }

    fun selectTab(tab: QuestionChatWorkspaceTab) {
        if (!state.tabsVisible) return
        state = state.copy(selectedTab = tab)
    }

    fun handleBack(): Boolean {
        if (!state.tabsVisible || state.selectedTab != QuestionChatWorkspaceTab.CHAT) return false
        state = state.copy(
            selectedTab = QuestionChatWorkspaceTab.QUESTION,
            questionFocusToken = state.questionFocusToken + 1
        )
        return true
    }
}

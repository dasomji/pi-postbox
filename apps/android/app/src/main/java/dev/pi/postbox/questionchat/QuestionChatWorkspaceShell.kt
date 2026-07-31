package dev.pi.postbox.questionchat

enum class QuestionChatWorkspaceTab {
    QUESTION,
    CHAT
}

data class QuestionChatSuggestedOptionReview(
    val optionValue: String,
    val token: Long
)

data class QuestionChatWorkspaceShellState(
    val key: QuestionChatBindingKey? = null,
    val tabsVisible: Boolean = false,
    val selectedTab: QuestionChatWorkspaceTab = QuestionChatWorkspaceTab.QUESTION,
    val runtimeReady: Boolean = false,
    val questionFocusToken: Long = 0L,
    val suggestedOptionReview: QuestionChatSuggestedOptionReview? = null
)

class QuestionChatWorkspaceShell {
    var state: QuestionChatWorkspaceShellState = QuestionChatWorkspaceShellState()
        private set

    fun bind(key: QuestionChatBindingKey?) {
        if (state.key == key) return
        state = QuestionChatWorkspaceShellState(
            key = key,
            tabsVisible = key != null
        )
    }

    fun onRecoveredRuntimeDiscovered() {
        if (state.key == null) return
        state = state.copy(
            tabsVisible = true,
            selectedTab = QuestionChatWorkspaceTab.QUESTION,
            runtimeReady = true
        )
    }

    fun onActivatedRuntimeReady() {
        if (state.key == null) return
        state = state.copy(
            tabsVisible = true,
            selectedTab = QuestionChatWorkspaceTab.CHAT,
            runtimeReady = true
        )
    }

    fun selectTab(tab: QuestionChatWorkspaceTab) {
        if (!state.tabsVisible) return
        state = state.copy(selectedTab = tab)
    }

    fun reviewSuggestedOption(optionValue: String) {
        if (!state.tabsVisible) return
        state = state.copy(
            selectedTab = QuestionChatWorkspaceTab.QUESTION,
            questionFocusToken = state.questionFocusToken + 1,
            suggestedOptionReview = QuestionChatSuggestedOptionReview(
                optionValue = optionValue,
                token = (state.suggestedOptionReview?.token ?: 0L) + 1L
            )
        )
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

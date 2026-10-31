import { reactive } from 'vue';

/**
 * What the Project header and the Project view share: the Brief dialog, opened from the header, after New project
 * or from the Add to project dialog; the chooser that **Change** shows in place of the panes; the session whose
 * summary is shown; the sidebar's tab, Sessions or Chats; and the chat pane's mode, Chat or Search. View state only;
 * the project itself is in the store.
 */
const state = reactive({
  briefOpen: false,
  choosing: false,
  selected: null as string | null,
  sidebarTab: 'sessions' as 'sessions' | 'chats',
  chatPaneMode: 'chat' as 'chat' | 'search',
});

export function useProjectUi() {
  return state;
}

/** Back to the start, e.g. between component tests. */
export function resetProjectUi(): void {
  state.briefOpen = false;
  state.choosing = false;
  state.selected = null;
  state.sidebarTab = 'sessions';
  state.chatPaneMode = 'chat';
}

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch, type Component } from 'vue';
import { useNavStore, type Mode, type Step } from './stores/nav';
import { useProjectStore } from './stores/project';
import AppHeader from './ui/components/AppHeader.vue';
import { useBrowserHistory } from './ui/composables/useBrowserHistory';
import GlossaryView from './ui/views/GlossaryView.vue';
import HomeView from './ui/views/HomeView.vue';
import OutputView from './ui/views/OutputView.vue';
import ProjectView from './ui/views/ProjectView.vue';
import SettingsView from './ui/views/SettingsView.vue';
import SetupView from './ui/views/SetupView.vue';

type View = Step | Exclude<Mode, 'transcribe'>;

const nav = useNavStore();
const views: Record<View, Component> = {
  home: HomeView,
  setup: SetupView,
  glossary: GlossaryView,
  output: OutputView,
  project: ProjectView,
  settings: SettingsView,
};
// Home, Project and Settings are one view each; Transcribe shows its current step.
const view = computed<View>(() => (nav.mode === 'transcribe' ? nav.step : nav.mode));
const mainEl = useTemplateRef<HTMLElement>('main');

// The remembered project folder: its name for Home, and the project itself if access is still granted.
void useProjectStore().init();

// The browser's Back and Forward move between pages (DECISIONS.md D28).
useBrowserHistory();

// After a mode or step change, move focus to the new view's heading so keyboard and screen-reader
// users start at the top of the new content. Not on first load.
watch(view, async () => {
  await nextTick();
  mainEl.value?.querySelector<HTMLElement>('h1')?.focus();
});
</script>

<template>
  <div class="app">
    <AppHeader />
    <main ref="main" class="app-main" :class="{ column: nav.mode === 'transcribe' }">
      <component :is="views[view]" />
    </main>
    <!-- Not on Settings itself: the top row already names it. -->
    <footer v-if="nav.mode !== 'settings'" class="app-footer">
      <button type="button" class="link-button" @click="nav.openSettings()">Settings</button>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 100vh;
  padding: var(--space-5) var(--page-gutter);
}

/* A column, so a view can grow to fill it and keep its StepFooter at the bottom of the window. */
.app-main {
  display: flex;
  flex: 1;
  flex-direction: column;
}

/* The Transcribe steps keep their centred column, as wide as when --content-width included 1rem of padding a side;
   the other pages use the window's width (D31). */
.column {
  width: 100%;
  max-width: calc(var(--content-width) - 2 * var(--space-4));
  margin-inline: auto;
}

.app-footer {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>

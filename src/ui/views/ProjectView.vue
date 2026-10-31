<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue';
import { useProjectStore } from '../../stores/project';
import BriefDialog from '../components/BriefDialog.vue';
import ChatList from '../components/ChatList.vue';
import ChatPane from '../components/ChatPane.vue';
import SessionList from '../components/SessionList.vue';
import SessionSummary from '../components/SessionSummary.vue';
import { useProjectUi } from '../composables/useProjectUi';

// Project mode (PROJECTS.md §5.6): connecting to the project folder, then the sidebar on the left, with the sessions
// and the saved chats (D29) as two tabs, and, on the right, the selected summary or else the chat pane, which also has
// the keyword search (D30). In a wide window the panes fill the window's height, the sidebar at its left edge and the
// detail pane's content centred beside it (D31), and each scrolls on its own, so the chat's question box stays in view.
// In a narrow window the summary takes the list's place, and the chat goes below the list.
// One block per status of the project store.
const project = useProjectStore();
const ui = useProjectUi();
const root = useTemplateRef<HTMLElement>('root');
const list = useTemplateRef<InstanceType<typeof SessionList>>('list');
const chatPane = useTemplateRef<InstanceType<typeof ChatPane>>('chatPane');

/** The panes stack at this width and below (see the CSS). */
const NARROW = '(max-width: 48rem)';

/** **Sessions** (in a narrow window) or Escape closes the summary. */
function back(): void {
  ui.selected = null;
}

/**
 * When the summary closes (its Back, Escape, or the browser's Back), focus goes to the chat's question box or, in a
 * narrow window, to the list, on the session that was shown.
 */
watch(
  () => ui.selected,
  async (now, shown) => {
    if (now !== null || shown === null) return;
    // After the render, which shows the chat again (v-show).
    await nextTick();
    if (window.matchMedia(NARROW).matches) await list.value?.focusSession(shown);
    else chatPane.value?.focusInput();
  },
);

// --- The sidebar's tabs: Sessions and Chats (D29) ------------------------------------------------

const tabs = computed(() => [
  { id: 'sessions' as const, label: 'Sessions', count: project.sessions.length },
  { id: 'chats' as const, label: 'Chats', count: project.chats.length },
]);

/** The arrow keys, Home and End move between the tabs and show the one they reach. */
async function onTabKeydown(event: KeyboardEvent, index: number): Promise<void> {
  const last = tabs.value.length - 1;
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % (last + 1)
      : event.key === 'ArrowLeft'
        ? (index + last) % (last + 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;
  const tab = next === null ? undefined : tabs.value[next];
  if (!tab) return;
  event.preventDefault();
  ui.sidebarTab = tab.id;
  await nextTick();
  document.getElementById(`sidebar-tab-${tab.id}`)?.focus();
}

/** **New chat** in the Chats tab: focus goes to the question box, once the chat pane is shown again. */
async function onNewChat(): Promise<void> {
  await nextTick();
  chatPane.value?.focusInput();
}

/** Escape in a summary goes back to the chat, unless something inside used it (a dialog, a field). */
function onDetailKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || ui.selected === null) return;
  if ((event.target as Element | null)?.closest('dialog, input, textarea, select')) return;
  event.preventDefault();
  back();
}

/** The chooser: no project yet, or **Change** with a project open (then **Cancel** goes back to it). */
const showChooser = computed(
  () => project.status === 'none' || (ui.choosing && project.status !== 'loading'),
);

const loadingText = computed(() => {
  const { done, total } = project.progress;
  return total === 0 ? 'Opening the project…' : `Reading ${done} of ${total} sessions`;
});

/** For screen readers: the load starting and ending, which sighted users see. */
const announcement = computed(() => {
  if (project.status === 'loading') return 'Opening the project…';
  if (project.status !== 'ready' || ui.choosing) return '';
  const n = project.sessions.length;
  return `${project.projectName ?? 'Analyse'} is open: ${n} ${n === 1 ? 'session' : 'sessions'}.`;
});

async function focusFirstButton(): Promise<void> {
  await nextTick();
  root.value?.querySelector<HTMLButtonElement>('.connect button')?.focus();
}

async function open(): Promise<void> {
  if (await project.openProject()) ui.choosing = false;
}

async function create(): Promise<void> {
  const result = await project.newProject();
  if (!result) return;
  ui.choosing = false;
  if (result.created) ui.briefOpen = true;
}

async function cancelChoosing(): Promise<void> {
  ui.choosing = false;
  project.notice = null;
  await nextTick();
  document.getElementById('project-change')?.focus();
}

watch(
  () => ui.choosing,
  (choosing) => {
    if (choosing) void focusFirstButton();
  },
);

// The chooser only makes sense with a project open; a lost connection or a new load ends it.
watch(
  () => project.status,
  (status) => {
    if (status !== 'ready') ui.choosing = false;
  },
);

// Entering Project mode doesn't fire `focus`, so rescan now for sessions added meanwhile.
onMounted(() => {
  if (project.status === 'ready') project.scheduleRefresh();
});
</script>

<template>
  <section ref="root" class="view" aria-labelledby="project-title">
    <!-- The top row shows the project's name; this heading names the view and takes focus on a mode change. -->
    <h1 id="project-title" class="visually-hidden" tabindex="-1">Analyse</h1>
    <p class="visually-hidden" role="status">{{ announcement }}</p>

    <p v-if="project.status === 'unsupported'" class="muted">
      This browser can't open project folders. Use Edge or Chrome.
    </p>

    <div v-else-if="showChooser" class="connect">
      <div class="actions">
        <button type="button" class="button button-primary" @click="open">Open project…</button>
        <button type="button" class="button" @click="create">New project…</button>
        <button v-if="ui.choosing" type="button" class="button" @click="cancelChoosing">
          Cancel
        </button>
      </div>
      <p class="muted">A project can be a local or shared folder.</p>
      <p v-if="project.notice" class="notice" role="alert">{{ project.notice }}</p>
    </div>

    <div v-else-if="project.status === 'reconnect'" class="connect">
      <div class="actions">
        <button type="button" class="button button-primary" @click="project.reconnect()">
          Reconnect “{{ project.projectName }}”
        </button>
        <button type="button" class="button" @click="open">Open another project…</button>
        <button type="button" class="button" @click="create">New project…</button>
      </div>
      <p v-if="project.notice" class="notice" role="alert">{{ project.notice }}</p>
    </div>

    <div v-else-if="project.status === 'loading'" class="connect">
      <p id="project-loading">{{ loadingText }}</p>
      <progress
        class="progress"
        :value="project.progress.done"
        :max="Math.max(project.progress.total, 1)"
        aria-labelledby="project-loading"
      />
    </div>

    <div v-else-if="project.status === 'error'" class="connect">
      <p class="notice" role="alert">{{ project.error }}</p>
      <div class="actions">
        <button type="button" class="button button-primary" @click="project.retry()">
          Try again
        </button>
        <button type="button" class="button" @click="open">Open another project…</button>
        <button type="button" class="button" @click="create">New project…</button>
      </div>
      <p v-if="project.notice" class="notice" role="alert">{{ project.notice }}</p>
    </div>

    <div v-else class="panes" :class="{ 'has-selection': ui.selected !== null }">
      <div class="sessions-pane">
        <div class="tabs" role="tablist">
          <button
            v-for="(tab, index) in tabs"
            :id="`sidebar-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            class="tab"
            role="tab"
            :aria-selected="ui.sidebarTab === tab.id"
            :aria-controls="`sidebar-panel-${tab.id}`"
            :tabindex="ui.sidebarTab === tab.id ? 0 : -1"
            @click="ui.sidebarTab = tab.id"
            @keydown="onTabKeydown($event, index)"
          >
            {{ tab.label }} <span class="count">{{ tab.count }}</span>
          </button>
        </div>
        <!-- Both stay mounted, so the lists' places survive a change of tab. -->
        <div
          v-show="ui.sidebarTab === 'sessions'"
          id="sidebar-panel-sessions"
          class="tab-panel"
          role="tabpanel"
          aria-labelledby="sidebar-tab-sessions"
        >
          <SessionList ref="list" />
        </div>
        <div
          v-show="ui.sidebarTab === 'chats'"
          id="sidebar-panel-chats"
          class="tab-panel"
          role="tabpanel"
          aria-labelledby="sidebar-tab-chats"
        >
          <ChatList @new="onNewChat" />
        </div>
      </div>
      <!-- The selected summary, or the chat, kept while a summary is shown. -->
      <div class="detail-pane" @keydown="onDetailKeydown">
        <SessionSummary v-if="ui.selected" :session-id="ui.selected" @back="back" />
        <ChatPane v-show="!ui.selected" ref="chatPane" />
      </div>
    </div>

    <BriefDialog :open="ui.briefOpen" @close="ui.briefOpen = false" />
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.muted {
  color: var(--color-text-muted);
}

/*
 * The chooser and the other states, on the same tinted plane as the sessions. At least 38rem wide, so the chooser's
 * line fits on one row, and wider when the buttons need it to stay on one row; the text keeps the measure it has at
 * 38rem.
 */
.connect {
  display: grid;
  justify-items: start;
  gap: var(--space-4);
  width: fit-content;
  min-width: min(38rem, 100%);
  max-width: 100%;
  padding: var(--space-6);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.connect > p {
  max-width: calc(38rem - 2 * var(--space-6));
}

/* One row of equal buttons, each as wide as the widest; stacked in a narrow window (below). */
.actions {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: var(--space-3) var(--space-3);
}

.actions > .button {
  justify-content: center;
}

.notice {
  color: var(--color-danger);
}

.progress {
  width: min(24rem, 100%);
  accent-color: var(--color-accent);
}

/*
 * Wide: the panes fill the window between the top row and the footer, and each scrolls on its own, so the chat's
 * question box is always on screen. Size containment keeps a long list from making the page taller instead.
 * The detail pane's content keeps the width it had in the 80rem page (D31), centred in the space beside the sidebar.
 */
.panes {
  --detail-width: 59rem;

  display: grid;
  flex: 1 1 0;
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: minmax(15rem, 17rem) minmax(0, 1fr);
  gap: var(--space-6);
  min-height: 24rem;
  contain: size;
}

/* Positioned, so the rows' visually hidden text stays inside the scroll area instead of lengthening the page. */
.tab-panel,
.detail-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

/*
 * The detail pane's scroll area reaches across App.vue's right padding to the page's edge, so its scrollbar sits where a
 * page's would, and its padding keeps the content in place. Its content (the summary or the chat) is centred in it at
 * --detail-width. ChatPane's messages and SessionSearch's results reach out to the same edge: --scroll-bleed is the
 * edge plus the space beside the centred content, and 100cqw is the pane's width (it is their query container).
 */
.detail-pane {
  --edge: var(--page-gutter);
  container-type: inline-size;
  margin-right: calc(-1 * var(--edge));
  padding-right: var(--edge);
}

/*
 * With the chat shown, the pane reaches below the sidebar by the height of ChatPane's Chat | Search toggle and the
 * space above it, so the question box ends level with the sidebar and the toggle sits beside the footer's link.
 */
.panes:not(.has-selection) .detail-pane {
  margin-bottom: calc(
    -1 * (var(--space-1) + var(--font-size-sm) * var(--line-height) + 0.25rem + 4px)
  );
}

.detail-pane > * {
  --scroll-bleed: calc(var(--edge) + max(0px, (100cqw - var(--detail-width)) / 2));
  width: 100%;
  max-width: var(--detail-width);
  margin-inline: auto;
}

/*
 * The sidebar sits on one tinted plane instead of between lines (SessionList and ChatList draw the rows for it). The
 * tabs, drawn as one segmented control, stay at its top while the open list scrolls under them.
 */
.sessions-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.tab-panel {
  flex: 1;
}

.tabs {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-text) 7%, var(--color-surface));
}

.tab {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-1);
  padding: 0.3125rem var(--space-2);
  border: 0;
  border-radius: calc(var(--radius-md) - 3px);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tab:hover {
  color: var(--color-text);
}

/* The open tab is lifted onto white. */
.tab[aria-selected='true'] {
  background: var(--color-bg);
  color: var(--color-accent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 14%, transparent);
}

.tab:focus-visible {
  outline-offset: 1px;
}

.count {
  color: var(--color-text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .tab {
    transition: none;
  }
}

/* Narrow: the list with the chat below it, or the selected summary alone; the page scrolls. */
@media (max-width: 48rem) {
  .actions {
    grid-auto-flow: row;
  }

  .panes {
    flex: none;
    grid-template-rows: none;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    min-height: 0;
    contain: none;
  }

  .tab-panel,
  .detail-pane {
    overflow: visible;
  }

  /* The page's own scrollbar is at its edge. */
  .detail-pane {
    --edge: 0px;
  }

  .panes:not(.has-selection) .detail-pane {
    height: 80dvh;
    margin-bottom: 0;
  }

  .has-selection .sessions-pane {
    display: none;
  }
}
</style>

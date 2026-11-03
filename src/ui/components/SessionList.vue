<script setup lang="ts">
import { computed, ref, useId, useTemplateRef, watch } from 'vue';
import { lacksEnglish } from '../../domain/corpus/sessionText';
import {
  formatDate,
  formatTimestamp,
  languageName,
  normalizeLanguage,
} from '../../domain/transcript';
import { projectModelLabel } from '../../providers/llm/models';
import { usePipelineStore, type SummaryStatus } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useProjectUi } from '../composables/useProjectUi';
import { useRovingListbox } from '../composables/useRovingListbox';
import ErrorDetails from './ErrorDetails.vue';
import PipelineStatus from './PipelineStatus.vue';
import SummariseDialog from './SummariseDialog.vue';

// The project's sessions, newest recording first (PROJECTS.md §5.6), each with its summary status. Selecting one
// shows its summary. One Tab stop (`useRovingListbox`). Files that couldn't be read and conflict copies are listed
// under a <details>; **Summarise all** is at the foot. The sidebar's Sessions tab shows the count, so the heading is
// for screen readers only.
const project = useProjectStore();
const pipeline = usePipelineStore();
const settings = useSettingsStore();
const ui = useProjectUi();
const id = useId();
const listEl = useTemplateRef<HTMLElement>('list');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each session's summary status, read out by screen readers. */
const STATUS_TEXT: Record<SummaryStatus, string> = {
  ok: 'Summarised',
  running: 'Summarising',
  queued: 'Waiting to be summarised',
  stale: 'Summary out of date',
  failed: 'Summary failed',
  none: 'No summary',
};

// The line under the open session's name: "DE · 01:32:10 · 14 Sept 2026" on screen, "German, 01:32:10, 14 Sept 2026"
// read out for every session.
const rows = computed(() =>
  project.sessions.map((s) => {
    const duration = s.text.durationSec === null ? null : formatTimestamp(s.text.durationSec);
    const date = formatDate(s.text.recordedAt);
    const code = normalizeLanguage(s.text.languageCode).toUpperCase();
    const language = languageName(s.text.languageCode);
    const status = pipeline.statusOf(s.sessionId);
    return {
      id: s.sessionId,
      name: s.title,
      shown: [code, duration, date].filter(Boolean).join(' · '),
      spoken: [language, duration, date].filter(Boolean).join(', '),
      text: STATUS_TEXT[status],
    };
  }),
);

const copies = computed(() =>
  project.sessions.flatMap((s) => s.copies.map((copy) => ({ copy, of: s.transcriptFile.name }))),
);

const problemsSummary = computed(() => {
  const parts: string[] = [];
  const unreadable = project.problems.length;
  if (unreadable > 0) parts.push(`${plural(unreadable, 'file', 'files')} couldn't be read`);
  if (copies.value.length > 0)
    parts.push(plural(copies.value.length, 'conflict copy', 'conflict copies'));
  return parts.join(' · ');
});

// --- Selection and the roving Tab stop -------------------------------------------------------------

function select(sessionId: string): void {
  focusId.value = sessionId;
  ui.selected = sessionId;
}

const { focusId, tabStop, focusItem, onKeydown } = useRovingListbox({
  ids: () => rows.value.map((r) => r.id),
  selected: () => ui.selected,
  list: listEl,
  select,
});

/** Focuses a session's item (back from the summary in a narrow window). */
defineExpose({ focusSession: focusItem });

// --- Summarise all ---------------------------------------------------------------------------------

const confirming = ref(false);
const pending = computed(() => pipeline.summariseAllIds);
/** While summaries are being made, the foot hides the button. */
const busy = computed(() => pipeline.current !== null);
/** The queue's progress ("Summarising 2 of 5") shows here; one session's shows only in its summary pane. */
const queueRunning = computed(() => busy.value && pipeline.queueProgress.total > 1);

const confirmMessage = computed(() => {
  const ids = new Set(pending.value);
  const seconds = project.sessions
    .filter((s) => ids.has(s.sessionId))
    .reduce((sum, s) => sum + (s.text.durationSec ?? 0), 0);
  const hours = seconds / 3600;
  const about =
    hours >= 1
      ? `about ${plural(Math.round(hours), 'hour', 'hours')}`
      : `about ${plural(Math.max(1, Math.round(seconds / 60)), 'minute', 'minutes')}`;
  const model = projectModelLabel(settings.projectModel);
  return `Summarise ${plural(ids.size, 'session', 'sessions')}, ${about}, with ${model}?`;
});

const translates = computed(() => {
  const ids = new Set(pending.value);
  return project.sessions.some((s) => ids.has(s.sessionId) && lacksEnglish(s.text));
});

function summariseAll(): void {
  confirming.value = false;
  void pipeline.summarise(pending.value);
}

// A session that is gone (removed, or another project) can't stay selected.
watch(
  () => project.sessions,
  (sessions) => {
    if (ui.selected && !sessions.some((s) => s.sessionId === ui.selected)) ui.selected = null;
  },
);
</script>

<template>
  <section class="session-list" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" class="visually-hidden">Sessions {{ project.sessions.length }}</h2>

    <ul
      v-if="rows.length > 0"
      ref="list"
      class="sessions"
      role="listbox"
      :aria-labelledby="`${id}-title`"
    >
      <li
        v-for="(row, index) in rows"
        :key="row.id"
        class="session"
        :class="{ selected: ui.selected === row.id }"
        role="option"
        :aria-selected="ui.selected === row.id"
        :tabindex="tabStop === row.id ? 0 : -1"
        :data-item-id="row.id"
        @click="select(row.id)"
        @focus="focusId = row.id"
        @keydown="onKeydown($event, index, row.id)"
      >
        <span class="name">{{ row.name }}</span>
        <span class="meta" aria-hidden="true">{{ row.shown }}</span>
        <span class="visually-hidden">{{ row.spoken }}. {{ row.text }}.</span>
      </li>
    </ul>
    <p v-else class="empty">No sessions yet.</p>

    <details v-if="problemsSummary" class="problems">
      <summary>{{ problemsSummary }}</summary>
      <ul>
        <li v-for="p in project.problems" :key="p.file">
          <span class="file">{{ p.file }}</span
          >: {{ p.message }}
        </li>
        <li v-for="c in copies" :key="c.copy">
          <span class="file">{{ c.copy }}</span
          >: an older copy of {{ c.of }}, not shown.
        </li>
      </ul>
    </details>

    <div v-if="queueRunning" class="foot">
      <PipelineStatus />
    </div>
    <div v-else-if="!busy && pending.length > 0" class="foot">
      <p v-if="pipeline.stopped" class="error" role="alert">{{ pipeline.stopped.userMessage }}</p>
      <ErrorDetails v-if="pipeline.stopped" :error="pipeline.stopped" />
      <button type="button" class="button" @click="confirming = true">
        Summarise all ({{ pending.length }})
      </button>
    </div>

    <SummariseDialog
      :open="confirming"
      title="Summarise all"
      :message="confirmMessage"
      confirm-label="Summarise"
      :translates="translates"
      @confirm="summariseAll"
      @cancel="confirming = false"
    />
  </section>
</template>

<style scoped>
/*
 * Drawn for the tinted sessions pane in ProjectView: no lines, one line per session. The open session is lifted onto
 * white and shows its whole name and its details (D13).
 */
/* At least as tall as the pane, so the foot can sit at its bottom. */
.session-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 100%;
}

.sessions {
  display: grid;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 0.4375rem var(--space-2);
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.session:hover {
  background: color-mix(in srgb, var(--color-bg) 70%, transparent);
}

.session.selected {
  row-gap: 2px;
  padding-block: var(--space-2);
  background: var(--color-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text) 10%, transparent);
}

/* Inside the row, so the scrolling pane doesn't clip the ring. */
.session:focus-visible {
  outline-offset: -2px;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session.selected .name {
  color: var(--color-accent);
  overflow-wrap: anywhere;
  white-space: normal;
}

.meta {
  display: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.session.selected .meta {
  display: block;
}

.empty {
  padding-inline: var(--space-2);
  color: var(--color-text-muted);
}

/* At the pane's bottom, the button as wide as the pane. Wide, it stays in view while a long list scrolls under it. */
.foot {
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
}

.foot .button {
  justify-content: center;
}

.foot .error,
.foot .error-details {
  padding-inline: var(--space-2);
}

@media not (max-width: 48rem) {
  .foot {
    position: sticky;
    bottom: 0;
    padding-top: var(--space-2);
    background: var(--color-surface);
  }
}

.error {
  color: var(--color-danger);
}

.problems {
  padding-inline: var(--space-2);
}

/* Chevron drawn like the glossary's skipped list: down when closed, up when open. */
.problems summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-warning);
  font-weight: 600;
  cursor: pointer;
}

.problems summary::after {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

.problems[open] summary::after {
  transform: translateY(25%) rotate(-135deg);
}

.problems ul {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  list-style: none;
}

.file {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .session,
  .problems summary::after {
    transition: none;
  }
}
</style>

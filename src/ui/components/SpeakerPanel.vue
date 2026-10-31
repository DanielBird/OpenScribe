<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { defaultSpeakerLabel, type Speaker } from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';
import { speakerColor } from '../speakerColor';

// Speaker names (DECISIONS.md D8). Each rename applies on every keystroke, so the turns update as
// the user types. A field showing the default name is left empty, with the default as placeholder.
const transcript = useTranscriptStore();
const id = useId();

const speakers = computed(() => transcript.doc?.speakers ?? []);

// Collapsed when the user has already named a speaker. Read once, so renaming doesn't close it.
const startOpen = speakers.value.every((s, i) => s.label === defaultSpeakerLabel(i));
// A rename replaces the doc but keeps its turns array, so the counts aren't recomputed per keystroke.
const turns = computed(() => transcript.doc?.turns ?? []);
const turnCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const turn of turns.value) counts.set(turn.speakerId, (counts.get(turn.speakerId) ?? 0) + 1);
  return counts;
});

// While a field has focus it shows exactly what was typed: the store trims, and an empty name
// becomes the default, which must not jump into the field mid-edit.
const editingId = ref<string | null>(null);
const draft = ref('');

function shownName(speaker: Speaker, index: number): string {
  return speaker.label === defaultSpeakerLabel(index) ? '' : speaker.label;
}

function onFocus(speaker: Speaker, index: number): void {
  editingId.value = speaker.id;
  draft.value = shownName(speaker, index);
}

function onInput(speaker: Speaker, event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
  transcript.renameSpeaker(speaker.id, draft.value);
}

function onBlur(): void {
  editingId.value = null;
}

const turnsText = (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`;
</script>

<template>
  <details class="speaker-panel" :open="startOpen">
    <summary>Speakers</summary>
    <ul class="rows">
      <li v-for="(speaker, i) in speakers" :key="speaker.id" class="row">
        <span class="swatch" :style="{ background: speakerColor(i) }" aria-hidden="true" />
        <label :for="`${id}-${i}`" class="visually-hidden">
          Name for {{ defaultSpeakerLabel(i) }}
        </label>
        <input
          :id="`${id}-${i}`"
          class="control"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="defaultSpeakerLabel(i)"
          :value="editingId === speaker.id ? draft : shownName(speaker, i)"
          @focus="onFocus(speaker, i)"
          @input="onInput(speaker, $event)"
          @blur="onBlur"
        />
        <span class="count">{{ turnsText(turnCounts.get(speaker.id) ?? 0) }}</span>
      </li>
    </ul>
  </details>
</template>

<style scoped>
/* A quiet label with Setup's chevron: down when closed, up when open. */
summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}

summary:hover {
  color: var(--color-accent);
}

summary::after {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

.speaker-panel[open] summary::after {
  transform: translateY(25%) rotate(-135deg);
}

/* A legend: the speakers side by side, each name typed straight into its field. */
.rows {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.swatch {
  flex: none;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
}

/* Filled like Glossary's chips; white while typing. */
.control {
  width: min(100%, 11rem);
  border-color: var(--color-border);
  background: var(--color-surface);
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.control:hover {
  border-color: var(--color-border-strong);
}

.control:focus {
  background: var(--color-bg);
}

.count {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

@media (prefers-reduced-motion: reduce) {
  summary::after,
  .control {
    transition: none;
  }
}
</style>

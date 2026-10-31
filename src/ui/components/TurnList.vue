<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import type { Speaker, Turn } from '../../domain/transcript';
import { speakerColor } from '../speakerColor';
import TurnItem from './TurnItem.vue';

// The transcript, one item per speaker turn. A 3-hour recording has about 2000 turns: v-memo
// re-renders only the turns whose label or text changed (e.g. one speaker's turns on rename).
// `texts` (turn id → text) shows a translation instead of the original; speakers and times stay.
// `activeId` is the turn being played; with `follow`, the list scrolls to it when it changes.
// `editable` turns each text into a box (D19); `edit` passes on what was typed, for the store.
const props = withDefaults(
  defineProps<{
    turns: readonly Turn[];
    speakers: readonly Speaker[];
    playable?: boolean;
    texts?: Readonly<Record<string, string>>;
    /** The language of the text shown, e.g. 'de' or 'en', for screen readers and hyphenation. */
    lang?: string;
    activeId?: string | null;
    follow?: boolean;
    editable?: boolean;
  }>(),
  {
    playable: false,
    texts: undefined,
    lang: undefined,
    activeId: null,
    follow: false,
    editable: false,
  },
);
const emit = defineEmits<{ select: [turn: Turn]; edit: [turnId: string, text: string] }>();

const speakerInfo = computed(() => {
  const info = new Map<string, { label: string; color: string }>();
  props.speakers.forEach((s, i) => info.set(s.id, { label: s.label, color: speakerColor(i) }));
  return info;
});

// A speaker id that isn't in the list can't happen with docs we build; show the raw id anyway.
const infoFor = (turn: Turn) =>
  speakerInfo.value.get(turn.speakerId) ?? { label: turn.speakerId, color: 'inherit' };

const textFor = (turn: Turn) => props.texts?.[turn.id] ?? turn.text;

const list = useTemplateRef<HTMLOListElement>('list');

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Also when Follow is switched on, so the list catches up with the recording. Not while the user is
// typing in one of the turns: the highlight still moves, but the list stays put.
const typingHere = () => {
  const focused = document.activeElement;
  return focused instanceof HTMLTextAreaElement && list.value?.contains(focused) === true;
};

watch(
  () => [props.activeId, props.follow] as const,
  async ([id, follow]) => {
    if (!id || !follow) return;
    await nextTick();
    if (typingHere()) return;
    list.value
      ?.querySelector(`[data-turn-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  },
);
</script>

<template>
  <ol ref="list" class="turn-list" :lang="lang">
    <TurnItem
      v-for="turn in turns"
      :key="turn.id"
      v-memo="[
        turn,
        infoFor(turn).label,
        infoFor(turn).color,
        textFor(turn),
        playable,
        turn.id === activeId,
        editable,
      ]"
      :turn="turn"
      :label="infoFor(turn).label"
      :color="infoFor(turn).color"
      :text="textFor(turn)"
      :playable="playable"
      :active="turn.id === activeId"
      :editable="editable"
      @select="emit('select', $event)"
      @edit="(turnId, text) => emit('edit', turnId, text)"
    />
  </ol>
</template>

<style scoped>
/* A plain column of turns. Each turn lays out its own fixed-width columns (TurnItem), so renaming a
   speaker re-lays out only that speaker's turns, not all 2000 of a long recording (DECISIONS.md D17). */
.turn-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>

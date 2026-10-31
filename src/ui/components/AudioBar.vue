<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { usePlaybackStore } from '../../stores/playback';
import { useTranscriptStore } from '../../stores/transcript';
import { useConfirm } from '../composables/useConfirm';
import { speakerColor } from '../speakerColor';
import ConfirmDialog from './ConfirmDialog.vue';
import FileDrop from './FileDrop.vue';

// The player at the bottom of the Output tab. The audio isn't stored (D10): after a reload it offers
// to attach the recording again. Space or K plays and pauses, except while typing or on a control.
const playback = usePlaybackStore();
const transcript = useTranscriptStore();
const { confirm, dialog } = useConfirm();

const audio = useTemplateRef<HTMLAudioElement>('audio');
watch(audio, (el) => playback.registerAudioElement(el ?? null), { flush: 'post' });
onMounted(() => playback.registerAudioElement(audio.value ?? null));
onBeforeUnmount(() => playback.registerAudioElement(null));

const activeSpeaker = computed(() => {
  const doc = transcript.doc;
  const turn = doc?.turns.find((t) => t.id === playback.activeTurnId);
  if (!doc || !turn) return null;
  const index = doc.speakers.findIndex((s) => s.id === turn.speakerId);
  return {
    label: doc.speakers[index]?.label ?? turn.speakerId,
    color: index === -1 ? 'transparent' : speakerColor(index),
  };
});

const offerReplace = computed(
  () => playback.playbackError !== null || playback.sourceMatch === 'mismatch',
);

function attach(file: File): void {
  const source = transcript.doc?.source.fileName ?? '';
  void playback.attachManual(file, () =>
    confirm({
      title: 'Use this recording?',
      message: `It doesn't match the transcript's recording ("${source}").`,
      confirmLabel: 'Use it',
    }),
  );
}

// --- Keyboard -------------------------------------------------------------------------------------

/** Where Space and K keep their usual meaning. */
const KEEP_KEYS_IN = 'input, textarea, select, button, summary, a, audio, [contenteditable]';

function onKeydown(event: KeyboardEvent): void {
  if (!playback.playable) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key !== ' ' && event.key.toLowerCase() !== 'k') return;
  if (event.target instanceof Element && event.target.closest(KEEP_KEYS_IN)) return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault(); // Space would scroll the page
  playback.togglePlay();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <section class="audio-bar" aria-label="Playback" data-testid="audio-bar">
    <template v-if="playback.audioUrl">
      <div class="player">
        <span
          v-if="activeSpeaker && !playback.playbackError"
          class="speaker"
          :style="{ '--speaker-color': activeSpeaker.color }"
        >
          {{ activeSpeaker.label }}
        </span>
        <audio ref="audio" controls preload="metadata" :src="playback.audioUrl" />
      </div>
      <p v-if="playback.playbackError" class="error" role="alert">{{ playback.playbackError }}</p>
      <p v-else-if="playback.sourceMatch === 'mismatch'" class="hint">
        Not the transcript's recording.
      </p>
      <div class="options">
        <label class="follow">
          <input v-model="playback.followPlayback" type="checkbox" />
          Follow playback
        </label>
        <!-- Always shown, not behind a disclosure (maintainer's call, an exception to D13). -->
        <p class="shortcut"><kbd>Space</kbd>: play or pause</p>
        <FileDrop
          v-if="offerReplace"
          compact
          prompt=""
          choose-label="Choose another file…"
          @select="attach"
        />
      </div>
    </template>
    <FileDrop v-else compact prompt="Attach the recording to listen along." @select="attach" />
    <ConfirmDialog v-bind="dialog" />
  </section>
</template>

<style scoped>
/* Pinned to the bottom of the window like StepFooter, so it stays in reach while the list scrolls. */
.audio-bar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
  padding-block: var(--space-3);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
}

.player {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.speaker {
  max-width: 10rem;
  overflow: hidden;
  font-size: var(--font-size-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Same dot as TurnItem: the colour marks the speaker, the name stays in the text colour. */
.speaker::before {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  margin-inline-end: var(--space-2);
  border-radius: 50%;
  background: var(--speaker-color);
  content: '';
}

audio {
  flex: 1;
  min-width: min(100%, 16rem);
  height: 2.5rem;
}

.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
}

.follow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.shortcut {
  color: var(--color-text-muted);
}

/* Like the Ctrl + Enter keys on Glossary. */
kbd {
  padding: 0 var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: inherit;
}

.error {
  color: var(--color-danger);
}

.hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>

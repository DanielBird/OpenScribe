<script setup lang="ts">
import { computed } from 'vue';
import { languageName } from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';

// Original | English. Shown only once an English translation exists (D13: nothing to switch to before).
const transcript = useTranscriptStore();

const hasTranslation = computed(() => transcript.doc?.translations.en !== undefined);
// "Original (German)", or "Original" when the language is not known.
const original = computed(() => {
  const language = transcript.doc ? languageName(transcript.doc.result.languageCode) : '';
  return language ? `Original (${language})` : 'Original';
});
</script>

<template>
  <div v-if="hasTranslation" class="version-toggle" role="group" aria-label="Version">
    <button
      type="button"
      class="button segment"
      :aria-pressed="transcript.view === 'original'"
      @click="transcript.view = 'original'"
    >
      {{ original }}
    </button>
    <button
      type="button"
      class="button segment"
      :aria-pressed="transcript.view === 'en'"
      @click="transcript.view = 'en'"
    >
      English
    </button>
  </div>
</template>

<style scoped>
/* Two buttons joined into one control. */
.version-toggle {
  display: inline-flex;
}

.segment {
  border-radius: 0;
}

.segment:first-child {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}

.segment:last-child {
  margin-left: -1px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* The pressed segment and the hovered one draw their full border above the neighbour's. */
.segment[aria-pressed='true'],
.segment:hover,
.segment:focus-visible {
  position: relative;
}

.segment[aria-pressed='true'] {
  font-weight: 600;
}
</style>

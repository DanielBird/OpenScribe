<script setup lang="ts">
import { computed } from 'vue';
import { redactSecret, technicalDetails } from '../../providers/errors';
import { useSettingsStore } from '../../stores/settings';

// What a problem report needs beyond an error's message (DECISIONS.md D41), closed under it. Outside the error's alert,
// so only the message is announced. Shown only for an error that has a status or a detail.
const props = defineProps<{ error: unknown }>();

const settings = useSettingsStore();

const text = computed(() => {
  const details = technicalDetails(props.error);
  if (details === null) return null;
  // Providers redact the key they used; wrappers in stores copy raw messages, so every saved key goes here too.
  const keys = [settings.elevenLabsKey, settings.claudeKey, settings.geminiKey];
  return keys.reduce(redactSecret, `DeScribe v${__APP_VERSION__} · ${details}`);
});
</script>

<template>
  <details v-if="text" class="error-details">
    <summary>Technical details</summary>
    <pre>{{ text }}</pre>
  </details>
</template>

<style scoped>
.error-details {
  flex-basis: 100%;
  min-width: 0;
}

summary {
  width: fit-content;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

pre {
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: all;
}
</style>

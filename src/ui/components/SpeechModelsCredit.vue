<script setup lang="ts">
import { useSpeechPackStore } from '../../stores/speechPack';

// About's credit for the speech models (Phase 36, DECISIONS.md D54), desktop only: SettingsView renders it only when
// `__DESKTOP__` is true, so the web build leaves it out. Names, links and licences come from pack.json, so the credit is
// the same before and after the download, and can't disagree with what the app downloads.
const credits = useSpeechPackStore().credits();
const copyright = [...new Set(credits.map((c) => c.copyright))].join(', ');

/** "", ", " or " and " before the model at `i`. */
const joiner = (i: number) => (i === 0 ? '' : i === credits.length - 1 ? ' and ' : ', ');
</script>

<template>
  <div class="speech-models">
    <h3>Speech models</h3>
    <p>
      Transcribing on this computer uses
      <template v-for="(model, i) in credits" :key="model.name"
        >{{ joiner(i)
        }}<a :href="model.card" target="_blank" rel="noopener noreferrer">{{ model.name }}</a> (<a
          :href="model.licence.url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ model.licence.name }}</a
        >)</template
      >, {{ copyright }}. DeScribe downloads them from Hugging Face when you click
      <strong>Download speech models</strong>, and sends nothing about you or your recordings.
      DeScribe is not affiliated with or endorsed by NVIDIA.
    </p>
  </div>
</template>

<style scoped>
.speech-models {
  display: grid;
  gap: var(--space-2);
}

h3 {
  margin: 0;
  font-size: var(--font-size-md);
}
</style>

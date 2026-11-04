<script setup lang="ts">
import { computed } from 'vue';
import {
  formatDateTime,
  formatTimestamp,
  languageName,
  type TranscriptDoc,
} from '../../domain/transcript';

// What was transcribed and how. Glossary, zero-retention and project entries appear only when they apply.
const props = defineProps<{
  doc: TranscriptDoc;
  /** The project the transcript is saved in (Phase 15). */
  project?: string | null;
}>();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const items = computed(() => {
  const { source, request, result, speakers } = props.doc;
  const list: { label: string; value: string }[] = [];

  const duration = result.audioDurationSec ?? source.durationSec;
  if (duration !== null) list.push({ label: 'Duration', value: formatTimestamp(duration) });

  // The confidence only means something when the language was detected, not chosen. A language that is not known
  // (Auto, and none detected) is left out.
  const confidence =
    request.languageHint === 'auto' && result.languageProbability !== null
      ? ` (${Math.round(result.languageProbability * 100)}%)`
      : '';
  const language = languageName(result.languageCode);
  if (language) list.push({ label: 'Language', value: language + confidence });
  list.push({ label: 'Speakers', value: plural(speakers.length, 'speaker', 'speakers') });
  list.push({ label: 'Transcribed', value: formatDateTime(props.doc.createdAt) });
  if (request.keyterms.length > 0) {
    list.push({
      label: 'Glossary',
      value: plural(request.keyterms.length, 'glossary term', 'glossary terms'),
    });
  }
  if (request.zeroRetention) list.push({ label: 'Storage', value: 'Zero retention' });
  if (props.project) list.push({ label: 'Analyse', value: `In ${props.project}` });
  return list;
});
</script>

<template>
  <header class="transcript-header">
    <h2 class="file-name">{{ doc.source.fileName }}</h2>
    <dl class="meta">
      <div v-for="item in items" :key="item.label">
        <dt class="visually-hidden">{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.transcript-header {
  display: grid;
  gap: var(--space-2);
  min-width: min(100%, 20rem);
}

/* The page's title: the recording's name. */
.file-name {
  font-size: var(--font-size-2xl);
  line-height: 1.15;
  letter-spacing: -0.01em;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* Each item is one line: the separator and the value side by side. */
.meta div {
  display: flex;
}

.meta dd {
  margin: 0;
}

/* A middle dot between items, kept out of the accessible text. */
.meta div + div::before {
  content: '·' / '';
  padding-inline: var(--space-2);
}
</style>

<script setup lang="ts">
import { computed, nextTick, useId, useTemplateRef } from 'vue';
import type { QuoteCheck } from '../../domain/corpus/quoteCheck';
import { formatTimestamp, languageName } from '../../domain/transcript';
import { useCopy } from '../composables/useCopy';

// One quote (PROJECTS.md §5.5, DECISIONS.md T13, D44). A verified quote shows the transcript's own words and copies
// them with their citation. A quote that wasn't found in its turn, or that leaves out words that could change what
// was said, is marked and can't be copied. Used by session summaries and chat answers.
const props = defineProps<{
  /** The transcript's own words when verified; what was claimed otherwise. */
  text: string;
  /** The quote check's result. */
  check: QuoteCheck['status'];
  /** `null` when the quote's turn isn't known (a chat quote with a bad ref). */
  speaker: string | null;
  /** Seconds; `null` as for `speaker`. */
  start: number | null;
  /** The original's language code when the text is a translation. */
  translatedFrom?: string | null;
  /** Shown when quotes from several sessions are listed together (the chat). */
  sessionTitle?: string | null;
  /** What **Copy** puts on the clipboard; `null` when it can't be copied. */
  citation: string | null;
}>();

const id = useId();
const { copied, fallback, status, copy } = useCopy();
const area = useTemplateRef<HTMLTextAreaElement>('area');

/** How many words of the quote name its **Copy** button. */
const LABEL_WORDS = 6;

const FLAGS: Record<Exclude<QuoteCheck['status'], 'verified'>, string> = {
  not_found: 'Not found in the transcript',
  unsafe_omission: 'Left-out words may change the meaning',
};
const flag = computed(() => (props.check === 'verified' ? null : FLAGS[props.check]));

const time = computed(() => (props.start === null ? null : formatTimestamp(props.start)));
const source = computed(() =>
  [
    props.speaker,
    time.value,
    props.sessionTitle,
    props.translatedFrom ? `translated from ${languageName(props.translatedFrom)}` : null,
  ]
    .filter(Boolean)
    .join(' · '),
);

/** "Copy quote: I just put them on the…", so each Copy button says which quote it copies. */
const copyLabel = computed(() => {
  const words = props.text.trim().split(/\s+/);
  const start = words.slice(0, LABEL_WORDS).join(' ');
  return `Copy quote: ${start}${words.length > LABEL_WORDS ? '…' : ''}`;
});

async function onCopy(): Promise<void> {
  if (props.citation === null) return;
  if (await copy(props.citation)) return;
  await nextTick();
  area.value?.focus();
  area.value?.select();
}
</script>

<template>
  <figure class="quote-card" :class="{ unverified: flag !== null }">
    <blockquote class="text">“{{ text }}”</blockquote>
    <figcaption class="caption">
      <span class="source">{{ source }}</span>
      <span v-if="flag !== null" class="flag">{{ flag }}</span>
      <button
        v-else-if="citation !== null"
        type="button"
        class="copy"
        :aria-label="copyLabel"
        @click="onCopy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </figcaption>
    <div v-if="fallback !== null" class="copy-fallback">
      <label :for="`${id}-copy`" class="visually-hidden">Quote with its citation</label>
      <textarea :id="`${id}-copy`" ref="area" class="control" rows="3" readonly :value="fallback" />
      <p class="hint">Press Ctrl+C to copy the selected text.</p>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ status }}</p>
  </figure>
</template>

<style scoped>
.quote-card {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.unverified {
  border-left-color: var(--color-warning);
}

.text {
  margin: 0;
  overflow-wrap: anywhere;
}

.unverified .text {
  color: var(--color-text-muted);
}

.caption {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.source {
  overflow-wrap: anywhere;
}

.flag {
  color: var(--color-warning);
  font-weight: 600;
}

.copy {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}

.copy:hover {
  color: var(--color-accent);
}

.copy-fallback {
  display: grid;
  gap: var(--space-1);
}

.copy-fallback textarea {
  width: 100%;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

@media (prefers-reduced-motion: reduce) {
  .copy {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import type { QuoteCheck } from '../../domain/corpus/quoteCheck';
import { formatTimestamp, languageName } from '../../domain/transcript';
import { useCopy } from '../composables/useCopy';
import { useOpenTranscript } from '../composables/useOpenTranscript';
import IconCopied from '../icons/IconCopied.vue';
import IconCopy from '../icons/IconCopy.vue';
import IconOpen from '../icons/IconOpen.vue';
import IconRemove from '../icons/IconRemove.vue';

// One quote (PROJECTS.md §5.5, DECISIONS.md T13, D44). A verified quote shows the transcript's own words and copies
// them with their citation. A quote that wasn't found in its turn, or that leaves out words that could change what
// was said, is marked and can't be copied. **Open** shows the quote's turn in the transcript, flagged or not, so it can
// be read in context. Used by session summaries and chat answers. While a summary is edited (Phase 39), a card's words
// can't be changed: **Remove quote** takes the place of **Copy** and **Open**.
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
  /** The quote's turn, for **Open**; `null` when it isn't known. */
  at?: { sessionId: string; turnId: string } | null;
  /** Editing a summary: **Remove quote** instead of **Copy** and **Open**. */
  removable?: boolean;
}>();
const emit = defineEmits<{ remove: [] }>();

const id = useId();
const { copied, fallback, status, copy } = useCopy();
const opener = useOpenTranscript();
const openError = ref('');
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

/** "I just put them on the…", so each button says which quote it is for. */
const quoteStart = computed(() => {
  const words = props.text.trim().split(/\s+/);
  return words.slice(0, LABEL_WORDS).join(' ') + (words.length > LABEL_WORDS ? '…' : '');
});
const copyLabel = computed(() => `Copy quote: ${quoteStart.value}`);
const openLabel = computed(() => `Open in transcript: ${quoteStart.value}`);
const removeLabel = computed(() => `Remove quote: ${quoteStart.value}`);

async function onOpen(): Promise<void> {
  const at = props.at;
  if (!at) return;
  openError.value = '';
  openError.value =
    (await opener.openTranscript(at.sessionId, {
      turnId: at.turnId,
      english: Boolean(props.translatedFrom),
    })) ?? '';
}

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
      <span v-if="removable" class="actions">
        <button type="button" class="icon-button" :aria-label="removeLabel" @click="emit('remove')">
          <IconRemove class="icon" />
          <span class="icon-tip" aria-hidden="true">Remove</span>
        </button>
      </span>
      <span v-else-if="(flag === null && citation !== null) || at" class="actions">
        <button
          v-if="flag === null && citation !== null"
          type="button"
          class="icon-button"
          :class="{ copied }"
          :aria-label="copyLabel"
          @click="onCopy"
        >
          <IconCopied v-if="copied" class="icon" />
          <IconCopy v-else class="icon" />
          <span class="icon-tip" aria-hidden="true">Copy</span>
        </button>
        <button
          v-if="at"
          type="button"
          class="icon-button"
          :aria-label="openLabel"
          :disabled="!opener.canOpen(at.sessionId)"
          @click="onOpen"
        >
          <IconOpen class="icon" />
          <span class="icon-tip" aria-hidden="true">Open</span>
        </button>
      </span>
    </figcaption>
    <p v-if="openError" class="open-error" role="alert">{{ openError }}</p>
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

/* Copy and Open, at the caption's end. */
.actions {
  display: inline-flex;
  align-self: center;
  gap: var(--space-1);
  margin: calc(-1 * var(--space-1));
  margin-left: auto;
  transition: opacity 0.15s;
}

/*
 * With a mouse, shown only while the card is pointed at, or while one of them has focus (they stay in the Tab order),
 * and for "Copied". A touch screen can't point, so it always shows them.
 */
@media (hover: hover) {
  .quote-card:not(:hover, :focus-within) .actions:not(:has(.copied)) {
    opacity: 0;
  }
}

/* Icon only; its name is the aria-label, and a tip says it on pointing (.icon-tip, base.css). The padding widens the
   target, the margin keeps it in place. */
.icon-button {
  position: relative;
  display: inline-flex;
  padding: var(--space-1);
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}

.icon-button .icon {
  width: 1.25em;
  height: 1.25em;
}

.icon-button:hover:not(:disabled),
.icon-button.copied {
  color: var(--color-accent);
}

.icon-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.open-error {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
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
  .actions,
  .icon-button {
    transition: none;
  }
}
</style>

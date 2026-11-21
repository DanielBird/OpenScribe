<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue';
import {
  findMatches,
  hiddenInWords,
  shiftMatches,
  snippet,
  withoutReplacements,
  type TextMatch,
} from '../../domain/replace';
import {
  cleanTurnText,
  formatTimestamp,
  type TranscriptDoc,
  type TranscriptVersion,
} from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';
import { useModalDialog } from '../composables/useModalDialog';
import { useRovingListbox } from '../composables/useRovingListbox';
import { useSmoothHeight } from '../composables/useSmoothHeight';

// Find and replace a name in the version on screen (Phase 38, DECISIONS.md D59). The matches are a snapshot taken
// when Find changes (debounced), not searched again after each replacement: a replaced match leaves the list, the
// later ones in its turn are moved (`shiftMatches`), and a skipped one stays. The list is one Tab stop
// (`useRovingListbox`); its selected option is the current match.
const props = defineProps<{
  open: boolean;
  version: TranscriptVersion;
  /** Fills Find when the dialog opens, e.g. the text selected in a turn. */
  initialFind?: string;
}>();
const emit = defineEmits<{ close: [] }>();

/** How long Find waits for the typing to stop before it searches. */
const SEARCH_DELAY_MS = 150;

interface Row {
  id: string;
  match: TextMatch;
  time: string;
  label: string;
  snippet: { before: string; match: string; after: string };
}

const transcript = useTranscriptStore();
const id = useId();
const ids = {
  title: `${id}-title`,
  version: `${id}-version`,
  find: `${id}-find`,
  replace: `${id}-replace`,
};

const dialogEl = useTemplateRef<HTMLDialogElement>('dialog');
const findInput = useTemplateRef<HTMLInputElement>('findInput');
const listEl = useTemplateRef<HTMLElement>('list');
const replaceAllButton = useTemplateRef<HTMLButtonElement>('replaceAllButton');
const cancelAllButton = useTemplateRef<HTMLButtonElement>('cancelAllButton');

const find = ref('');
const replaceWith = ref('');
/** The Find the rows were found for. Replacing uses it, not a Find still being typed. */
const searchedFor = ref('');
/** The matches still to go, never deeply reactive (rule 8). */
const rows = shallowRef<readonly Row[]>([]);
const current = ref(0);
/** How many were replaced since Find last changed. */
const replaced = ref(0);
/** Replace all asks first, in place of the buttons (Phase 38, decision 5). */
const confirming = ref(false);
const announcement = ref('');
let nextRowId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const replacement = computed(() => cleanTurnText(replaceWith.value));

/**
 * Once the text has no match left: how many times the Original's words still have Find, which the text no longer
 * shows (after Edit text). Replace all takes those out too, so the name isn't left in the saved file (decision 10).
 */
const hidden = computed(() => {
  const doc = transcript.doc;
  if (!props.open || props.version !== 'original' || rows.value.length > 0 || !doc) return 0;
  if (searchedFor.value.trim() === '') return 0;
  let n = 0;
  for (const turn of doc.turns) n += hiddenInWords(turn.text, turn.words, searchedFor.value);
  return n;
});

/** What Replace all would replace: the matches listed, or else those only the words have. */
const allCount = computed(() => (rows.value.length > 0 ? rows.value.length : hidden.value));
const canReplace = computed(() => replacement.value !== '' && rows.value.length > 0);
const canReplaceAll = computed(() => replacement.value !== '' && allCount.value > 0);

const countText = computed(() => {
  if (rows.value.length > 0) return `${current.value + 1} of ${rows.value.length}`;
  if (hidden.value > 0) return `${hidden.value} left in the saved word timings`;
  if (replaced.value > 0) return `${replaced.value} replaced`;
  return searchedFor.value.trim() !== '' ? 'No matches' : '';
});

const { onCancelEvent, onClose } = useModalDialog(dialogEl, () => props.open, {
  focusOnOpen: () => findInput.value,
  onCancel: () => emit('close'),
});

// The dialog grows and shrinks smoothly as matches are found or dropped, instead of jumping.
useSmoothHeight(dialogEl, useTemplateRef<HTMLElement>('body'));

const {
  focusId,
  tabStop,
  onKeydown: onListKeydown,
} = useRovingListbox({
  ids: () => rows.value.map((r) => r.id),
  selected: () => rows.value[current.value]?.id ?? null,
  list: listEl,
  select: (rowId) => selectRow(rows.value.findIndex((r) => r.id === rowId)),
});

// --- The text searched ------------------------------------------------------------------------------

/** The texts of the version on screen. In the English view, only the turns that have their own English. */
function sourcesOf(doc: TranscriptDoc): { turnId: string; text: string }[] {
  if (props.version === 'original') return doc.turns.map((t) => ({ turnId: t.id, text: t.text }));
  const texts = doc.translations.en?.texts ?? {};
  return doc.turns
    .filter((t) => Object.hasOwn(texts, t.id))
    .map((t) => ({ turnId: t.id, text: texts[t.id]! }));
}

function textOf(turnId: string): string {
  const doc = transcript.doc;
  if (!doc) return '';
  if (props.version === 'en') return doc.translations.en?.texts[turnId] ?? '';
  return doc.turns.find((t) => t.id === turnId)?.text ?? '';
}

function search(): void {
  clearTimeout(timer);
  timer = undefined;
  confirming.value = false;
  replaced.value = 0;
  current.value = 0;
  focusId.value = null;
  searchedFor.value = find.value;
  const doc = transcript.doc;
  if (!doc) {
    rows.value = [];
    return;
  }
  const sources = sourcesOf(doc);
  const matches = findMatches(sources, find.value);
  rows.value = matches.length === 0 ? [] : toRows(matches, doc, sources);
}

/** The rows for `matches`, found in `sources` (the texts of the version on screen). */
function toRows(
  matches: readonly TextMatch[],
  doc: TranscriptDoc,
  sources: readonly { turnId: string; text: string }[],
): Row[] {
  const texts = new Map(sources.map((s) => [s.turnId, s.text]));
  const turns = new Map(doc.turns.map((t) => [t.id, t]));
  const labels = new Map(doc.speakers.map((s) => [s.id, s.label]));
  return matches.map((match) => {
    const turn = turns.get(match.turnId)!;
    return {
      id: String(nextRowId++),
      match,
      time: formatTimestamp(turn.start),
      label: labels.get(turn.speakerId) ?? turn.speakerId,
      snippet: snippet(texts.get(match.turnId)!, match),
    };
  });
}

/**
 * Lists these turns' matches again, from their text now, leaving out the ones inside a replacement. For when a
 * replacement didn't go in where the list said (the text there no longer reads as Find), so the rows point at the
 * text again instead of at nothing.
 */
function relist(turnIds: ReadonlySet<string>): void {
  const doc = transcript.doc;
  if (!doc) return;
  const sources = sourcesOf(doc).filter((s) => turnIds.has(s.turnId));
  const fresh = sources.flatMap((s) =>
    withoutReplacements(s.text, findMatches([s], searchedFor.value), replacement.value),
  );
  const order = new Map(doc.turns.map((t, i) => [t.id, i]));
  rows.value = [
    ...rows.value.filter((r) => !turnIds.has(r.match.turnId)),
    ...toRows(fresh, doc, sources),
  ].sort(
    (a, b) =>
      order.get(a.match.turnId)! - order.get(b.match.turnId)! || a.match.start - b.match.start,
  );
}

watch(find, () => {
  confirming.value = false;
  clearTimeout(timer);
  timer = find.value === searchedFor.value ? undefined : setTimeout(search, SEARCH_DELAY_MS);
});

watch(
  () => props.open,
  (open) => {
    // Closed, it holds nothing: no names left in the page, and nothing for a search of the page to find.
    clearTimeout(timer);
    timer = undefined;
    find.value = open ? (props.initialFind ?? '') : '';
    replaceWith.value = '';
    announcement.value = '';
    searchedFor.value = '';
    rows.value = [];
    replaced.value = 0;
    confirming.value = false;
    if (open) search();
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(timer));

// --- Next, Replace, Replace all ---------------------------------------------------------------------

/** Says the current match, or the count once none are left. Cleared first, so the same text is read again. */
async function announce(): Promise<void> {
  const row = rows.value[current.value];
  const text = row ? `${countText.value}: ${row.label}, ${row.time}` : countText.value;
  announcement.value = '';
  await nextTick();
  announcement.value = text;
}

function selectRow(index: number): void {
  if (index < 0 || index >= rows.value.length) return;
  current.value = index;
}

function next(): void {
  if (rows.value.length === 0) return;
  current.value = (current.value + 1) % rows.value.length;
  focusId.value = null; // the Tab stop follows the current match
  void announce();
}

/** Enter in Find or Replace with is Next; a Find still waiting to search searches first. */
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;
  event.preventDefault();
  if (find.value !== searchedFor.value) {
    search();
    if (rows.value.length > 0) void announce();
  } else {
    next();
  }
}

async function replaceCurrent(): Promise<void> {
  const row = rows.value[current.value];
  const text = replacement.value;
  if (!row || text === '') return;
  // The last match left changes the words as Replace all does, so a name only they still have doesn't stay.
  const scope = rows.value.length === 1 ? 'all' : 'one';
  const done = transcript.replaceMatches(
    props.version,
    [row.match],
    text,
    searchedFor.value,
    scope,
  );
  if (done === 0) {
    relist(new Set([row.match.turnId]));
  } else {
    const rest = rows.value.filter((r) => r !== row);
    const shifted = shiftMatches(
      rest.map((r) => r.match),
      row.match,
      text,
    );
    const turnText = textOf(row.match.turnId);
    rows.value = rest.map((r, i) =>
      r.match.turnId === row.match.turnId
        ? { ...r, match: shifted[i]!, snippet: snippet(turnText, shifted[i]!) }
        : r,
    );
    replaced.value += done;
  }
  if (current.value >= rows.value.length) current.value = 0;
  focusId.value = null;
  void announce();
  if (rows.value.length === 0) {
    // Replace is disabled now, and would take the focus with it.
    await nextTick();
    findInput.value?.focus();
  }
}

async function askReplaceAll(): Promise<void> {
  if (timer !== undefined) search(); // a Find still waiting: ask about what it finds, not the list before it
  if (!canReplaceAll.value) {
    await nextTick();
    findInput.value?.focus();
    return;
  }
  confirming.value = true;
  await nextTick();
  cancelAllButton.value?.focus(); // the safe choice, as ConfirmDialog does for what can't be undone
}

async function cancelReplaceAll(): Promise<void> {
  confirming.value = false;
  await nextTick();
  replaceAllButton.value?.focus();
}

async function replaceAll(): Promise<void> {
  const text = replacement.value;
  const listed = rows.value;
  const count = allCount.value;
  if (text === '' || count === 0) return;
  const done = transcript.replaceMatches(
    props.version,
    listed.map((r) => r.match),
    text,
    searchedFor.value,
    'all',
  );
  rows.value = [];
  current.value = 0;
  confirming.value = false;
  if (listed.length === 0) {
    replaced.value += count - hidden.value; // only the words had them
  } else {
    replaced.value += done;
    if (done < listed.length) relist(new Set(listed.map((r) => r.match.turnId)));
  }
  void announce();
  await nextTick();
  findInput.value?.focus(); // ready for the next name
}

// The current match stays in view inside the list only: the page behind doesn't move (decision 8).
watch(
  [current, rows],
  () => {
    const list = listEl.value;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <dialog
    ref="dialog"
    class="replace-dialog"
    :aria-labelledby="ids.title"
    :aria-describedby="open && version === 'en' ? ids.version : undefined"
    @cancel="onCancelEvent"
    @close="onClose"
  >
    <div ref="body" class="body">
      <header class="head">
        <div class="heading">
          <h2 :id="ids.title" class="title">Find and replace</h2>
          <p v-if="open && version === 'en'" :id="ids.version" class="version">
            In the English translation
          </p>
        </div>
        <button type="button" class="icon-button" aria-label="Close" @click="emit('close')">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
          <span class="icon-tip" aria-hidden="true">Close</span>
        </button>
      </header>

      <div class="fields">
        <div class="field">
          <label :for="ids.find" class="label">Find</label>
          <input
            :id="ids.find"
            ref="findInput"
            v-model="find"
            type="text"
            class="input"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="onEnter"
          />
        </div>
        <div class="field">
          <label :for="ids.replace" class="label">Replace with</label>
          <input
            :id="ids.replace"
            v-model="replaceWith"
            type="text"
            class="input"
            autocomplete="off"
            @keydown.enter="onEnter"
          />
        </div>
      </div>

      <ul v-if="rows.length > 0" ref="list" class="matches" role="listbox" aria-label="Matches">
        <li
          v-for="(row, index) in rows"
          :key="row.id"
          class="match"
          role="option"
          :aria-selected="index === current"
          :tabindex="tabStop === row.id ? 0 : -1"
          :data-item-id="row.id"
          @click="selectRow(index)"
          @focus="focusId = row.id"
          @keydown="onListKeydown($event, index, row.id)"
        >
          <span class="meta">
            <span class="speaker">{{ row.label }}</span>
            <span class="time">{{ row.time }}</span>
          </span>
          <span class="snippet"
            >{{ row.snippet.before }}<mark>{{ row.snippet.match }}</mark
            >{{ row.snippet.after }}</span
          >
        </li>
      </ul>

      <div v-if="confirming" class="foot">
        <span class="question">Replace all {{ allCount }}?</span>
        <div class="actions">
          <button ref="cancelAllButton" type="button" class="button" @click="cancelReplaceAll">
            Cancel
          </button>
          <button
            type="button"
            class="button button-danger"
            :disabled="!canReplaceAll"
            @click="replaceAll"
          >
            Replace all
          </button>
        </div>
      </div>
      <div v-else class="foot">
        <span v-if="countText" class="count">{{ countText }}</span>
        <div class="actions">
          <button type="button" class="button quiet" :disabled="rows.length === 0" @click="next">
            Next
          </button>
          <button
            ref="replaceAllButton"
            type="button"
            class="button quiet"
            :disabled="!canReplaceAll"
            @click="askReplaceAll"
          >
            Replace all
          </button>
          <button
            type="button"
            class="button button-primary"
            :disabled="!canReplace"
            @click="replaceCurrent"
          >
            Replace
          </button>
        </div>
      </div>

      <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>
    </div>
  </dialog>
</template>

<style scoped>
.replace-dialog {
  width: min(38rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100vh - 2 * var(--space-4));
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--color-text) 16%, transparent);
}

.replace-dialog::backdrop {
  background: var(--color-backdrop);
}

/*
 * Sized by what's in it, not by the dialog, so its height is the one the dialog glides to (useSmoothHeight). It
 * keeps within the dialog's max-height (less its padding and border) itself: the list shrinks to fit.
 */
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: calc(100vh - 2 * var(--space-4) - 2 * var(--space-5) - 2px);
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.title {
  font-size: var(--font-size-lg);
  line-height: 1.25;
}

.version {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.icon-button {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2)) 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

/* The two fields are one control: a shared edge, a hairline between them. */
.fields {
  display: grid;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.fields:focus-within {
  border-color: var(--color-accent);
}

.field {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  align-items: center;
}

.field + .field {
  border-top: 1px solid var(--color-border);
}

.field:focus-within {
  background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg));
}

.label {
  padding-inline-start: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.field:focus-within .label {
  color: var(--color-accent);
}

.input {
  min-width: 0;
  padding: var(--space-3) var(--space-3) var(--space-3) 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
}

/* The field's tint and the block's accent edge show the focus. */
.input:focus-visible {
  outline: none;
}

.input::selection,
.snippet::selection {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
}

/* A tray: the rows sit on the surface, and the current one is lifted onto the page's white. */
.matches {
  position: relative;
  display: grid;
  flex: 0 1 auto;
  gap: 2px;
  min-height: 4rem;
  max-height: 40vh;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  list-style: none;
  scrollbar-color: var(--color-border-strong) transparent;
  scrollbar-width: thin;
}

.match {
  display: grid;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  /* A name in most turns lists over 1,500 rows: rows out of view aren't laid out or painted until scrolled to. */
  content-visibility: auto;
  contain-intrinsic-size: auto 4rem;
}

.match:hover {
  background: color-mix(in srgb, var(--color-bg) 60%, transparent);
}

.match[aria-selected='true'] {
  background: var(--color-bg);
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--color-text) 10%, transparent),
    0 0 0 1px var(--color-border);
}

.match:focus-visible {
  outline-offset: -2px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
  font-size: var(--font-size-sm);
}

.speaker {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.time {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.snippet {
  overflow-wrap: anywhere;
}

mark {
  border-radius: 2px;
  background: var(--color-highlight);
  color: inherit;
}

/* The count and the actions share one row. */
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.count {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.question {
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.quiet {
  background: none;
}
</style>

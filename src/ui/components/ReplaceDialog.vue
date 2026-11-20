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
import { findMatches, shiftMatches, snippet, type TextMatch } from '../../domain/replace';
import {
  cleanTurnText,
  formatTimestamp,
  type TranscriptDoc,
  type TranscriptVersion,
} from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';
import { useModalDialog } from '../composables/useModalDialog';
import { useRovingListbox } from '../composables/useRovingListbox';

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
const canReplace = computed(() => replacement.value !== '' && rows.value.length > 0);

const countText = computed(() => {
  if (rows.value.length > 0) return `${current.value + 1} of ${rows.value.length}`;
  if (replaced.value > 0) return `${replaced.value} replaced`;
  return searchedFor.value.trim() !== '' ? 'No matches' : '';
});

const { onCancelEvent, onClose } = useModalDialog(dialogEl, () => props.open, {
  focusOnOpen: () => findInput.value,
  onCancel: () => emit('close'),
});

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
  if (matches.length === 0) {
    rows.value = [];
    return;
  }
  const texts = new Map(sources.map((s) => [s.turnId, s.text]));
  const turns = new Map(doc.turns.map((t) => [t.id, t]));
  const labels = new Map(doc.speakers.map((s) => [s.id, s.label]));
  rows.value = matches.map((match) => {
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

function replaceCurrent(): void {
  const row = rows.value[current.value];
  const text = replacement.value;
  if (!row || text === '') return;
  transcript.replaceMatches(props.version, [row.match], text, searchedFor.value, 'one');
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
  replaced.value++;
  if (current.value >= rows.value.length) current.value = 0;
  focusId.value = null;
  void announce();
}

async function askReplaceAll(): Promise<void> {
  if (!canReplace.value) return;
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
  if (text === '' || rows.value.length === 0) return;
  transcript.replaceMatches(
    props.version,
    rows.value.map((r) => r.match),
    text,
    searchedFor.value,
    'all',
  );
  replaced.value += rows.value.length;
  rows.value = [];
  current.value = 0;
  confirming.value = false;
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
    <h2 :id="ids.title" class="title">Find and replace</h2>
    <p v-if="open && version === 'en'" :id="ids.version" class="version">
      In the English translation
    </p>

    <div class="fields">
      <div class="field">
        <label :for="ids.find" class="label">Find</label>
        <input
          :id="ids.find"
          ref="findInput"
          v-model="find"
          type="text"
          class="control"
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
          class="control"
          autocomplete="off"
          @keydown.enter="onEnter"
        />
      </div>
    </div>

    <p v-if="countText" class="count">{{ countText }}</p>

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
          <span class="time">{{ row.time }}</span>
          <span class="speaker">{{ row.label }}</span>
        </span>
        <span class="snippet"
          >{{ row.snippet.before }}<mark>{{ row.snippet.match }}</mark
          >{{ row.snippet.after }}</span
        >
      </li>
    </ul>

    <div v-if="confirming" class="actions">
      <span class="question">Replace all {{ rows.length }}?</span>
      <button ref="cancelAllButton" type="button" class="button" @click="cancelReplaceAll">
        Cancel
      </button>
      <button
        type="button"
        class="button button-danger"
        :disabled="!canReplace"
        @click="replaceAll"
      >
        Replace all
      </button>
    </div>
    <div v-else class="actions">
      <button type="button" class="button" :disabled="rows.length === 0" @click="next">Next</button>
      <button type="button" class="button" :disabled="!canReplace" @click="replaceCurrent">
        Replace
      </button>
      <button
        ref="replaceAllButton"
        type="button"
        class="button"
        :disabled="!canReplace"
        @click="askReplaceAll"
      >
        Replace all
      </button>
      <button type="button" class="button close" @click="emit('close')">Close</button>
    </div>

    <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>
  </dialog>
</template>

<style scoped>
.replace-dialog {
  width: min(40rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100vh - 2 * var(--space-4));
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

/* Only while open: a closed <dialog> must stay display: none. */
.replace-dialog[open] {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.replace-dialog::backdrop {
  background: var(--color-backdrop);
}

.title {
  font-size: var(--font-size-lg);
}

.version {
  margin-top: calc(-1 * var(--space-3));
  color: var(--color-text-muted);
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--space-3);
}

.field {
  display: grid;
  gap: var(--space-1);
}

.label {
  font-weight: 600;
}

.count {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

/* Positioned, so the rows' offsetTop is measured from the list's top. */
.matches {
  position: relative;
  flex: 0 1 auto;
  min-height: 4rem;
  max-height: 40vh;
  margin: 0;
  padding: var(--space-1);
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  list-style: none;
}

.match {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.match:hover {
  background: var(--color-surface);
}

.match[aria-selected='true'] {
  border-left-color: var(--color-accent);
  background: var(--color-button-hover);
}

.match:focus-visible {
  outline-offset: -2px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  font-size: var(--font-size-sm);
}

.time {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.speaker {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.snippet {
  overflow-wrap: anywhere;
}

mark {
  border-radius: 2px;
  background: var(--color-highlight);
  color: inherit;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.question {
  margin-inline-end: auto;
  font-weight: 600;
}

/* Close sits apart from the actions on the match. */
.close {
  margin-inline-start: var(--space-3);
}
</style>

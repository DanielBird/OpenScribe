<script setup lang="ts">
import { ref } from 'vue';
import { cleanTurnText, formatTimestamp, joinLines, type Turn } from '../../domain/transcript';

// One speaker turn: the speaker in the left column, the timestamp above the text on the right.
// `text` is passed separately so a translation can be shown instead (Phase 6).
// The timestamp is a button only when the recording can be played; until then it's text. Clicking the
// text also plays (a mouse shortcut; the button is the keyboard path), unless the user is selecting text.
// With `editable`, the text is a box instead (DECISIONS.md D19): clicking it places the caret, and the
// timestamp still plays. `outdated` marks a translation made before the turn's text was changed (D39).
const props = defineProps<{
  turn: Turn;
  label: string;
  color: string;
  text: string;
  playable?: boolean;
  /** The turn being played. */
  active?: boolean;
  editable?: boolean;
  /** `text` is a translation of what the turn said before it was edited. */
  outdated?: boolean;
}>();
const emit = defineEmits<{ select: [turn: Turn]; edit: [turnId: string, text: string] }>();

function onTextClick(): void {
  if (!props.playable) return;
  if (window.getSelection()?.isCollapsed === false) return;
  emit('select', props.turn);
}

// --- Editing --------------------------------------------------------------------------------------
// Like SpeakerPanel's names: while the box has focus it shows exactly what was typed, and every
// keystroke goes to the store, which cleans and saves it. The text never has line breaks.

const editing = ref(false);
const draft = ref('');
/** The text when the box got focus. Escape, or a box left empty, puts it back. */
let before = '';

const hasLineBreak = (text: string) => joinLines(text) !== text;

function onFocus(): void {
  before = props.text;
  draft.value = props.text;
  editing.value = true;
}

function onInput(event: Event): void {
  const box = event.target as HTMLTextAreaElement;
  // A line break can still get in, e.g. by drag and drop. Setting the value clears the box's undo
  // history, so this is only for that rare case; paste is handled below.
  if (hasLineBreak(box.value)) {
    const head = joinLines(box.value.slice(0, box.selectionStart));
    box.value = head + joinLines(box.value.slice(box.selectionStart));
    box.setSelectionRange(head.length, head.length);
  }
  draft.value = box.value;
  emit('edit', props.turn.id, box.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const box = event.target as HTMLTextAreaElement;
  if (event.key === 'Enter') {
    event.preventDefault();
    box.blur(); // Enter finishes editing
  } else if (event.key === 'Escape') {
    event.preventDefault();
    draft.value = before;
    emit('edit', props.turn.id, before);
    box.blur();
  }
}

function onPaste(event: ClipboardEvent): void {
  const pasted = event.clipboardData?.getData('text/plain') ?? '';
  if (!hasLineBreak(pasted)) return;
  event.preventDefault();
  const box = event.target as HTMLTextAreaElement;
  const text = joinLines(pasted);
  // insertText keeps Ctrl+Z working, which setting the value would not. It fires `input` itself.
  const inserted =
    typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!inserted) {
    box.setRangeText(text, box.selectionStart, box.selectionEnd, 'end');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function onBlur(): void {
  if (cleanTurnText(draft.value) === '') emit('edit', props.turn.id, before);
  editing.value = false;
}
</script>

<template>
  <!-- DOM order (timestamp, speaker, text) is the reading order; the grid only places them. -->
  <li
    class="turn"
    :class="{ 'is-active': active, 'is-playable': playable }"
    :style="{ '--turn-color': color }"
    :data-turn-id="turn.id"
    :aria-current="active ? 'true' : undefined"
  >
    <span class="time-row">
      <button
        v-if="playable"
        type="button"
        class="timestamp is-button"
        :aria-label="`Play from ${formatTimestamp(turn.start)}`"
        @click="emit('select', turn)"
      >
        {{ formatTimestamp(turn.start) }}
      </button>
      <span v-else class="timestamp">{{ formatTimestamp(turn.start) }}</span>
      <span v-if="outdated" class="outdated">Changed since translation</span>
    </span>
    <span class="speaker">{{ label }}</span>
    <!-- Screen readers hear "Speaker 1: …". Visually hidden is absolutely positioned: no grid cell. -->
    <span class="visually-hidden">: </span>
    <!-- The name says whose turn it is, so Tab between boxes needs nothing else read out. -->
    <textarea
      v-if="editable"
      class="text text-box"
      rows="1"
      :aria-label="`${label}, ${formatTimestamp(turn.start)}`"
      :value="editing ? draft : text"
      @focus="onFocus"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @blur="onBlur"
    />
    <p v-else class="text" @click="onTextClick">{{ text }}</p>
  </li>
</template>

<style scoped>
/* The speaker column has a fixed width, the same in every turn, so the text lines up down the list
   and a rename doesn't move it (DECISIONS.md D17). Long names wrap. */
.turn {
  display: grid;
  grid-template-areas:
    '. time'
    'speaker text';
  grid-template-columns: 10rem minmax(0, 1fr);
  position: relative;
  isolation: isolate;
  gap: var(--space-1) var(--space-4);
  align-items: baseline;
  /* Following playback scrolls a turn into view; keep it clear of the sticky AudioBar. */
  scroll-margin-block: var(--space-4) 8rem;
}

/* The turn being played: a bar in the speaker's colour and a light tint, drawn just outside the
   turn so the columns don't move. */
.turn.is-active::before {
  position: absolute;
  z-index: -1;
  inset: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) calc(-1 * var(--space-2))
    calc(-1 * var(--space-3));
  border-left: 3px solid var(--turn-color);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--turn-color) 8%, var(--color-bg));
  content: '';
}

.turn.is-playable p.text {
  cursor: pointer;
}

.time-row {
  display: flex;
  grid-area: time;
  flex-wrap: wrap;
  align-items: baseline;
  justify-self: start;
  gap: 0 var(--space-3);
}

.timestamp {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

/* Quiet until pointed at: the underline appears on hover. */
.timestamp.is-button {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.timestamp.is-button:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.outdated {
  color: var(--color-warning);
  font-size: var(--font-size-sm);
}

.speaker {
  grid-area: speaker;
  font-size: var(--font-size-sm);
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* The speaker's colour is a dot, not the text colour: most palette colours are too light for text. */
.speaker::before {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  margin-inline-end: var(--space-2);
  border-radius: 50%;
  background: var(--turn-color);
  content: '';
}

/* The text has the same box in both modes, so turning Edit text on moves nothing (DECISIONS.md D19).
   Its 1px border, transparent until then, sits on the line box: line-height 1.6 leaves room above and
   below the letters. The side padding is taken back on the left by a negative margin, so the text
   lines up with the timestamp, and the box ends at the column's right edge. pre-wrap is how a textarea
   wraps. */
.text {
  grid-area: text;
  width: calc(100% + var(--space-2));
  margin: -1px 0 -1px calc(-1 * var(--space-2));
  padding: 0 calc(var(--space-2) - 1px);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Editing only shows the border. The height follows the text (field-sizing: Chromium 123+); hiding
   overflow keeps a rounding error from adding a scrollbar, which would narrow the text. */
.text-box {
  display: block;
  border-color: var(--color-border);
  background: var(--color-bg);
  color: inherit;
  resize: none;
  field-sizing: content;
}

@supports (field-sizing: content) {
  .text-box {
    overflow: hidden;
  }
}

.text-box:hover {
  border-color: var(--color-border-strong);
}

/* Narrow windows: one column, so the text keeps a readable width. */
@media (max-width: 30rem) {
  .turn {
    grid-template-areas:
      'time'
      'speaker'
      'text';
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

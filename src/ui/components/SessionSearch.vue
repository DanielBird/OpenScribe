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
import type { SearchHit, SessionHits } from '../../domain/corpus/search';
import { plural } from '../../domain/text';
import { formatTimestamp } from '../../domain/transcript';
import { useProjectStore } from '../../stores/project';
import { writeClipboard } from '../clipboard';

// The researchers' keyword search (PROJECTS.md §5.6, A16), on the same engine as the agent's search tool: the chat
// pane's Search mode (D30). The results scroll above the box, where the conversation is in Chat mode.
const project = useProjectStore();
const id = useId();
const ids = { input: `${id}-input`, error: `${id}-error`, copy: `${id}-copy` };
const root = useTemplateRef<HTMLElement>('root');
const area = useTemplateRef<HTMLElement>('area');
const input = useTemplateRef<HTMLInputElement>('input');

/** Searching starts this long after the last keystroke; Enter searches at once. */
const DEBOUNCE_MS = 250;
const COPIED_MS = 1500;

const query = ref('');
/** The query the results are for. */
const searched = ref('');
const error = ref('');
const sessions = shallowRef<SessionHits[]>([]);
const totals = ref({ hits: 0, sessions: 0 });
const nextOffset = ref<number | null>(null);
const active = computed(() => searched.value !== '' && error.value === '');

const countText = computed(() => {
  if (!active.value) return '';
  const { hits, sessions: n } = totals.value;
  return hits === 0
    ? 'No matches'
    : `${plural(hits, 'hit', 'hits')} in ${plural(n, 'session', 'sessions')}`;
});

function run(): void {
  const text = query.value.trim();
  if (text === '') {
    clearResults();
    return;
  }
  const outcome = project.search(text);
  searched.value = text;
  open.value = null;
  allHits.value = new Map();
  if (outcome.kind === 'error') {
    error.value = outcome.message;
    sessions.value = [];
    nextOffset.value = null;
    return;
  }
  error.value = '';
  sessions.value = outcome.result.sessions;
  totals.value = { hits: outcome.result.totalHits, sessions: outcome.result.totalSessions };
  nextOffset.value = outcome.result.nextOffset;
  // New results start at the top.
  if (area.value) area.value.scrollTop = 0;
}

function clearResults(): void {
  searched.value = '';
  error.value = '';
  sessions.value = [];
  nextOffset.value = null;
  copyFallback.value = null;
  open.value = null;
  allHits.value = new Map();
}

let timer: ReturnType<typeof setTimeout> | null = null;

function cancelTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

watch(query, (text) => {
  cancelTimer();
  // An empty box brings the list back at once.
  if (text.trim() === '') {
    clearResults();
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    run();
  }, DEBOUNCE_MS);
});

function runNow(): void {
  cancelTimer();
  run();
}

function clear(): void {
  query.value = '';
  cancelTimer();
  clearResults();
}

// A rescan that adds or changes sessions changes the answers: search again from the first page.
watch(
  () => project.corpus,
  () => {
    if (searched.value !== '') run();
  },
);

async function more(): Promise<void> {
  if (nextOffset.value === null) return;
  const outcome = project.search(searched.value, nextOffset.value);
  if (outcome.kind !== 'result') return;
  const first = sessions.value.length;
  sessions.value = [...sessions.value, ...outcome.result.sessions];
  nextOffset.value = outcome.result.nextOffset;
  // The More button may be gone: start at the first new session.
  await nextTick();
  root.value?.querySelectorAll<HTMLElement>('.result-title')[first]?.focus();
}

// --- Snippets --------------------------------------------------------------------------------------

interface Part {
  text: string;
  marked: boolean;
}

/** `text` from `from` to `to`, cut into plain and matched parts, so matches can be marked without HTML. */
function segments(text: string, marks: SearchHit['marks'], from = 0, to = text.length): Part[] {
  const parts: Part[] = [];
  let at = from;
  for (const [markStart, markEnd] of marks) {
    const start = Math.max(markStart, from);
    const end = Math.min(markEnd, to);
    if (end <= start) continue;
    if (start > at) parts.push({ text: text.slice(at, start), marked: false });
    parts.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < to) parts.push({ text: text.slice(at, to), marked: false });
  return parts;
}

// --- Opening a hit ---------------------------------------------------------------------------------

const OPEN_MS = 220;
const TIMING: KeyframeAnimationOptions = {
  duration: OPEN_MS,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};
/** An open quote shows at least this many lines, and always one more than its snippet. */
const OPEN_LINES = 3;

/**
 * A hit's quote, and the id its toggle controls. Stable across More and Show all; a new search closes any open one.
 */
const quoteId = (sessionIndex: number, hitIndex: number) => `${id}-hit-${sessionIndex}-${hitIndex}`;
/** The quote showing its whole turn, by quoteId(). Opening another closes it. */
const open = ref<string | null>(null);
/** The quote shrinking back, which keeps its whole turn until it has. */
const closing = ref<string | null>(null);
/** Whether the open quote is longer than it is tall, so it scrolls and can take focus. */
const openScrolls = ref(false);

/** A hit opens when its snippet isn't already the whole turn. */
const canOpen = (hit: SearchHit) => hit.snippetStart > 0 || hit.snippetEnd < hit.turnText.length;

/**
 * The quote: the snippet's words and, while it shows the whole turn, the turn before them (a block above, so the
 * words keep their lines) and after them, in place of the closing `…`.
 */
function quoteRegions(
  hit: SearchHit,
  quote: string,
): { kind: 'before' | 'words' | 'after'; parts: Part[] }[] {
  const { turnText: text, turnMarks: marks, snippetStart: start, snippetEnd: end } = hit;
  const words = [
    ...(start > 0 ? [{ text: '…', marked: false }] : []),
    ...segments(text, marks, start, end),
  ];
  if (open.value !== quote && closing.value !== quote) {
    if (end < text.length) words.push({ text: '…', marked: false });
    return [{ kind: 'words', parts: words }];
  }
  return [
    { kind: 'before', parts: segments(text, marks, 0, start) },
    { kind: 'words', parts: words },
    { kind: 'after', parts: segments(text, marks, end) },
  ];
}

/**
 * A click anywhere on a hit opens or closes it, except on Copy and its fallback, and except a click that ends a
 * selection, so words can still be selected. (The toggle's own click, from the keyboard too, arrives here.)
 */
function onHitClick(event: MouseEvent, hit: SearchHit, quote: string): void {
  if (!canOpen(hit)) return;
  if ((event.target as Element | null)?.closest('.copy, .copy-fallback')) return;
  if (event.detail > 0 && window.getSelection()?.isCollapsed === false) return;
  void toggle(quote);
}

const lineHeight = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight) || 0;

/** Starts an animation. Cancelling it, as the next click may, rejects its `finished`, which nothing need wait on. */
function play(
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions = TIMING,
): Animation {
  const animation = el.animate(keyframes, options);
  animation.finished.catch(() => undefined);
  return animation;
}

/** How far down an open quote its snippet's words start: it is scrolled that far. */
const wordsTop = (el: HTMLElement) => el.querySelector<HTMLElement>('.before')?.offsetHeight ?? 0;

/** A quote still shrinking from an earlier click shows its snippet at once. */
function endClosing(): void {
  const el = closing.value === null ? null : document.getElementById(closing.value);
  closing.value = null;
  if (!el) return;
  for (const animation of el.getAnimations({ subtree: true })) animation.cancel();
  el.style.removeProperty('height');
}

/**
 * Opens or closes a quote, without moving its snippet's words: the box grows below them, scrolled past the turn
 * before them, as the turn after them fades in where the `…` was. Closing does the reverse, gliding back to the
 * words first if the box was scrolled. The quote closing and the one opening move together.
 */
async function toggle(quote: string): Promise<void> {
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (closing.value !== null) {
    endClosing();
    await nextTick();
  }
  const shut = open.value;
  const opening = shut === quote ? null : quote;
  const shutEl = shut === null ? null : document.getElementById(shut);
  const openEl = opening === null ? null : document.getElementById(opening);
  for (const el of [shutEl, openEl]) {
    for (const animation of el?.getAnimations({ subtree: true }) ?? []) animation.cancel();
  }
  const snippetHeight = openEl?.offsetHeight ?? 0;

  let shutFrom = 0;
  let shutTo = 0;
  let scrolled = 0;
  if (shutEl) {
    shutFrom = shutEl.offsetHeight;
    scrolled = shutEl.scrollTop - wordsTop(shutEl);
    // Its snippet alone, to measure; it shows the whole turn again before anything is painted.
    shutEl.style.removeProperty('height');
    open.value = null;
    await nextTick();
    shutTo = shutEl.offsetHeight;
  }

  open.value = opening;
  closing.value = motion ? shut : null;
  openScrolls.value = false;
  await nextTick();

  if (openEl) {
    const top = wordsTop(openEl);
    const line = lineHeight(openEl);
    const lines = line > 0 ? Math.max(OPEN_LINES, Math.round(snippetHeight / line) + 1) : 0;
    const height = Math.min(openEl.scrollHeight - top, lines * line);
    openEl.style.height = `${height}px`;
    openEl.scrollTop = top;
    openScrolls.value = openEl.scrollHeight > height;
    // Measured at its new size, so the hit's end comes into view as well.
    openEl
      .closest('li')
      ?.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' });
    if (motion) {
      play(openEl, [{ height: `${snippetHeight}px` }, { height: `${height}px` }]);
      const after = openEl.querySelector('.after');
      if (after) play(after, [{ opacity: 0 }, { opacity: 1 }]);
    }
  }

  if (shutEl && motion) {
    const animation = play(shutEl, [{ height: `${shutFrom}px` }, { height: `${shutTo}px` }]);
    // Scrolled to the words (there is room now, at its animated height), shown where the reader had scrolled to.
    shutEl.scrollTop = wordsTop(shutEl);
    const text = shutEl.querySelector('.quote-text');
    if (text && scrolled !== 0) {
      play(text, [{ transform: `translateY(${-scrolled}px)` }, { transform: 'none' }]);
    }
    const after = shutEl.querySelector('.after');
    if (after) play(after, [{ opacity: 1 }, { opacity: 0 }], { ...TIMING, fill: 'forwards' });
    // Finished, or cancelled by the next click.
    const end = () => {
      if (closing.value === shut) endClosing();
    };
    void animation.finished.then(end, end);
  }
}

// --- Show all --------------------------------------------------------------------------------------

/** Every hit of the sessions showing all of theirs, by session id. A new search shows the first few again. */
const allHits = shallowRef<ReadonlyMap<string, SearchHit[]>>(new Map());
const hitsOf = (s: SessionHits) => allHits.value.get(s.sessionId) ?? s.hits;
const showingAll = (s: SessionHits) => allHits.value.has(s.sessionId);

const hitList = (sessionIndex: number) =>
  root.value?.querySelectorAll<HTMLElement>('ul.hits')[sessionIndex] ?? null;

/** Ends a list's growing at once. */
function settle(list: HTMLElement): void {
  for (const el of [list, ...list.children]) {
    for (const animation of el.getAnimations()) animation.cancel();
  }
  list.style.removeProperty('overflow');
}

/**
 * Lists every hit of a session after its first few, which stay where they are: the list grows over the sessions
 * below it, as far as can be seen, while the new hits fade in. The first new hit takes focus.
 */
async function showAll(s: SessionHits, sessionIndex: number): Promise<void> {
  const all = project.searchSession(searched.value, s.sessionId);
  if (all === null) return;
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const list = hitList(sessionIndex);
  const from = list?.offsetHeight ?? 0;
  allHits.value = new Map(allHits.value).set(s.sessionId, all.hits);
  await nextTick();
  if (!list) return;
  const fresh = [...list.children].slice(s.hits.length) as HTMLElement[];
  const first = fresh[0];
  if (!first) return;

  if (motion && area.value) {
    // As far down as will be seen once the first new hit is scrolled into view.
    const listTop = list.getBoundingClientRect().top;
    const seen =
      Math.max(area.value.getBoundingClientRect().bottom, first.getBoundingClientRect().bottom) -
      listTop;
    const to = Math.min(list.offsetHeight, Math.max(from, seen));
    // Clipped, not hidden: a list that could scroll would scroll itself to the first new hit below.
    list.style.overflow = 'clip';
    const grow = play(list, [{ height: `${from}px` }, { height: `${to}px` }]);
    const done = () => list.style.removeProperty('overflow');
    void grow.finished.then(done, done);
    for (const hit of fresh) {
      if (hit.getBoundingClientRect().top - listTop > to) break;
      play(hit, [{ opacity: 0 }, { opacity: 1 }]);
    }
  }
  first.querySelector('button')?.focus({ preventScroll: true });
  first.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' });
}

/**
 * Lists a session's first few hits again. Its button, and everything below it, stay where they are: the rest of the
 * session scrolls down to meet it. An open hit that goes is closed.
 */
async function showFewer(s: SessionHits, sessionIndex: number, button: HTMLElement): Promise<void> {
  const top = button.getBoundingClientRect().top;
  const list = hitList(sessionIndex);
  if (list) settle(list);
  const gone = hitsOf(s).slice(s.hits.length);
  const quotes = new Set(gone.map((_, i) => quoteId(sessionIndex, s.hits.length + i)));
  if (closing.value !== null && quotes.has(closing.value)) endClosing();
  if (open.value !== null && quotes.has(open.value)) open.value = null;
  const fallback = copyFallback.value?.key;
  if (gone.some((hit) => keyOf(s.sessionId, hit.turnId) === fallback)) copyFallback.value = null;

  const next = new Map(allHits.value);
  next.delete(s.sessionId);
  allHits.value = next;
  await nextTick();
  if (area.value) area.value.scrollTop += button.getBoundingClientRect().top - top;
}

function toggleAll(event: MouseEvent, s: SessionHits, sessionIndex: number): void {
  if (showingAll(s)) void showFewer(s, sessionIndex, event.currentTarget as HTMLElement);
  else void showAll(s, sessionIndex);
}

// --- Copy ------------------------------------------------------------------------------------------

const keyOf = (sessionId: string, turnId: string) => `${sessionId}/${turnId}`;
/** The hit whose Copy just worked, shown as "Copied" for a moment. */
const copied = ref<string | null>(null);
/** The hit whose text couldn't be copied, shown selected for Ctrl+C. */
const copyFallback = ref<{ key: string; text: string } | null>(null);
const copyStatus = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copy(sessionId: string, hit: SearchHit): Promise<void> {
  const text = project.citationFor(sessionId, hit.turnId);
  if (text === null) return;
  const key = keyOf(sessionId, hit.turnId);
  copyStatus.value = '';
  if (await writeClipboard(text)) {
    copyFallback.value = null;
    copied.value = key;
    copyStatus.value = 'Copied with its citation.';
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = null), COPIED_MS);
    return;
  }
  copyFallback.value = { key, text };
  copyStatus.value = "Couldn't copy automatically. The text is selected: press Ctrl+C to copy it.";
  await nextTick();
  const area = root.value?.querySelector<HTMLTextAreaElement>('.copy-fallback textarea');
  area?.focus();
  area?.select();
}

onBeforeUnmount(() => {
  cancelTimer();
  if (copiedTimer !== null) clearTimeout(copiedTimer);
});

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div ref="root" class="session-search">
    <div ref="area" class="results-area">
      <!-- Always rendered, so a new count is announced. -->
      <p class="count" :class="{ 'visually-hidden': !active }" role="status">{{ countText }}</p>
      <p class="visually-hidden" aria-live="polite">{{ copyStatus }}</p>

      <ol v-if="active && sessions.length > 0" class="results">
        <li v-for="(s, si) in sessions" :key="s.sessionId" class="result">
          <h3 class="result-title" tabindex="-1">
            <span class="title-text">{{ project.sessionTitle(s.sessionId) }}</span>
            {{ ' ' }}
            <span class="hit-count">{{ plural(s.hitCount, 'hit', 'hits') }}</span>
          </h3>
          <ul class="hits">
            <li
              v-for="(hit, hi) in hitsOf(s)"
              :key="hit.turnId"
              class="hit"
              :class="{ 'can-open': canOpen(hit) }"
              @click="onHitClick($event, hit, quoteId(si, hi))"
            >
              <div class="hit-head">
                <button
                  v-if="canOpen(hit)"
                  type="button"
                  class="hit-toggle"
                  :aria-expanded="open === quoteId(si, hi)"
                  :aria-controls="quoteId(si, hi)"
                >
                  <span class="speaker">{{
                    project.speakerLabel(s.sessionId, hit.speakerId)
                  }}</span>
                  {{ ' ' }}
                  <span class="time">{{ formatTimestamp(hit.start) }}</span>
                </button>
                <template v-else>
                  <span class="speaker">{{
                    project.speakerLabel(s.sessionId, hit.speakerId)
                  }}</span>
                  {{ ' ' }}
                  <span class="time">{{ formatTimestamp(hit.start) }}</span>
                </template>
                <button
                  type="button"
                  class="copy"
                  :aria-label="`Copy, ${project.speakerLabel(s.sessionId, hit.speakerId)} at ${formatTimestamp(hit.start)}`"
                  @click="copy(s.sessionId, hit)"
                >
                  {{ copied === keyOf(s.sessionId, hit.turnId) ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <p
                :id="quoteId(si, hi)"
                class="snippet"
                :class="{ open: open === quoteId(si, hi) }"
                :tabindex="open === quoteId(si, hi) && openScrolls ? 0 : undefined"
              >
                <span class="quote-text"
                  ><span
                    v-for="region in quoteRegions(hit, quoteId(si, hi))"
                    :key="region.kind"
                    :class="region.kind"
                    ><template v-for="(part, i) in region.parts" :key="i"
                      ><mark v-if="part.marked">{{ part.text }}</mark
                      ><template v-else>{{ part.text }}</template></template
                    ></span
                  ></span
                >
              </p>
              <div
                v-if="copyFallback?.key === keyOf(s.sessionId, hit.turnId)"
                class="copy-fallback"
              >
                <label :for="ids.copy" class="visually-hidden">Quote with its citation</label>
                <textarea
                  :id="ids.copy"
                  class="control"
                  rows="3"
                  readonly
                  :value="copyFallback.text"
                />
                <p class="hint">Press Ctrl+C to copy the selected text.</p>
              </div>
            </li>
          </ul>
          <button
            v-if="s.hitCount > s.hits.length"
            type="button"
            class="show-all"
            :aria-label="
              showingAll(s)
                ? `Show fewer hits in ${project.sessionTitle(s.sessionId)}`
                : `Show all ${s.hitCount} hits in ${project.sessionTitle(s.sessionId)}`
            "
            @click="toggleAll($event, s, si)"
          >
            {{ showingAll(s) ? 'Show fewer' : 'Show all' }}
          </button>
        </li>
      </ol>
      <div v-if="active && nextOffset !== null">
        <button type="button" class="button" @click="more">More</button>
      </div>
    </div>

    <div class="box">
      <label :for="ids.input" class="visually-hidden">Search transcripts</label>
      <input
        :id="ids.input"
        ref="input"
        v-model="query"
        type="search"
        class="control"
        placeholder="Search transcripts"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? ids.error : undefined"
        @keydown.enter.prevent="runNow"
        @keydown.escape.prevent="clear"
      />
      <p v-if="error" :id="ids.error" class="query-error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Drawn for the white chat pane, laid out like ChatPane's Chat mode: the results scroll above the box. */
.session-search {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

/*
 * Positioned, so the visually hidden status lines stay inside its scroll area. Like ChatPane's messages, it reaches
 * --scroll-bleed past the pane's right edge, so the scrollbar is at the page's edge (ProjectView).
 */
.results-area {
  position: relative;
  display: grid;
  flex: 1;
  gap: var(--space-3);
  align-content: start;
  min-height: 0;
  margin-right: calc(-1 * var(--scroll-bleed, 0px));
  padding-right: var(--scroll-bleed, 0px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.box {
  display: grid;
  gap: var(--space-1);
}

.box input {
  width: 100%;
}

.box input[aria-invalid='true'] {
  border-color: var(--color-danger);
}

.box input[aria-invalid='true']:focus-visible {
  box-shadow: inset 0 0 0 1px var(--color-danger);
}

.query-error {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.count {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.results {
  display: grid;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.result {
  display: grid;
  gap: var(--space-2);
}

.result-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  font-size: var(--font-size-md);
  font-weight: 600;
}

.title-text {
  overflow-wrap: anywhere;
}

.hit-count {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 400;
}

.hits {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.hit {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  transition: background-color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* A hit with more to its turn opens on a click anywhere on it. */
.hit.can-open {
  cursor: pointer;
}

.hit.can-open:hover {
  background: color-mix(in srgb, var(--color-text) 4%, var(--color-surface));
}

.hit-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--font-size-sm);
}

/* The speaker and time, as the keyboard's way to open the hit: drawn as the text they are. */
.hit-toggle {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  text-align: start;
  cursor: pointer;
}

.speaker {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.time {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.copy,
.show-all {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}

.copy {
  margin-left: auto;
}

.copy:hover,
.show-all:hover {
  color: var(--color-accent);
}

/* Under the session's hits, quiet like Copy. */
.show-all {
  justify-self: start;
  font-size: var(--font-size-sm);
}

/*
 * The quote keeps its scrollbar's room even when closed, so opening it doesn't move a word. It reaches into the hit's
 * right padding by about as much, so its words have the width they had before.
 */
.snippet {
  margin-right: calc(-1 * var(--space-3));
  overflow: hidden;
  overflow-wrap: anywhere;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

/* Open: the whole turn, scrolled to the snippet's words (toggle() sets its height). */
.snippet.open {
  overflow-y: auto;
}

/* Blocks: the turn before the words ends its own line, and the closing quote's text can glide as one. */
.quote-text,
.before {
  display: block;
}

mark {
  border-radius: 2px;
  background: var(--color-highlight);
  color: inherit;
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
  .hit,
  .copy,
  .show-all {
    transition: none;
  }
}
</style>

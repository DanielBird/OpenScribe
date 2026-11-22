<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
  watch,
} from 'vue';
import { formatCitation, type CitationParts } from '../../domain/corpus/citation';
import { checkQuote } from '../../domain/corpus/quoteCheck';
import {
  englishText,
  isEnglishSession,
  isTranslatedSession,
  lacksEnglish,
} from '../../domain/corpus/sessionText';
import { NOT_DISCUSSED, type SummaryQuote } from '../../domain/summary';
import { overviewParagraphs, type QuotePlace } from '../../domain/summaryEdit';
import { formatDate, formatTimestamp, languageName } from '../../domain/transcript';
import { SUMMARY_LIMITS } from '../../features/summary/check';
import { projectModelLabel } from '../../providers/llm/models';
import { usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useSummaryEditStore } from '../../stores/summaryEdit';
import { useOpenTranscript } from '../composables/useOpenTranscript';
import { useSummaryEditing, vBlockText } from '../composables/useSummaryEditing';
import IconEdit from '../icons/IconEdit.vue';
import IconOpen from '../icons/IconOpen.vue';
import IconAdd from '../icons/IconAdd.vue';
import IconRemove from '../icons/IconRemove.vue';
import ErrorDetails from './ErrorDetails.vue';
import FolderNotice from './FolderNotice.vue';
import PipelineStatus from './PipelineStatus.vue';
import QuoteCard from './QuoteCard.vue';
import SummariseDialog from './SummariseDialog.vue';

// The selected session's summary in Project mode (PROJECTS.md §5.6): its status and what to do about it, then the
// summary itself. **Regenerate** makes a new one. Every quote is checked against the transcript as it is now, and only
// a quote that is found can be copied (T13). **Edit** (Phase 39, D60) makes the summary a document the user types in,
// as in Word: each piece of text becomes editable where it stands (useSummaryEditing), and **Done** ends it.
const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ back: [] }>();

const project = useProjectStore();
const pipeline = usePipelineStore();
const edit = useSummaryEditStore();
const opener = useOpenTranscript();
const id = useId();
const heading = useTemplateRef<HTMLElement>('heading');
const article = useTemplateRef<HTMLElement>('article');
const editButton = useTemplateRef<HTMLButtonElement>('editButton');

const session = computed(() => project.session(props.sessionId) ?? null);
const status = computed(() => pipeline.statusOf(props.sessionId));
const failure = computed(() => pipeline.failureFor(props.sessionId));
const file = computed(() => session.value?.summary ?? null);
const text = computed(() => session.value?.text ?? null);

const {
  editing,
  version,
  paragraphs,
  pendingQuote,
  blockAttrs,
  blockEvents,
  onKeydown,
  onAddTheme,
  onRemoveTheme,
  onAddQuote,
  onRemoveQuote,
} = useSummaryEditing({
  sessionId: () => props.sessionId,
  text: () => text.value,
  container: article,
  done: editButton,
});

/** The summary on screen: the draft while editing, the file's otherwise. */
const summary = computed(() => (editing.value ? edit.draft : (file.value?.summary ?? null)));

const turns = computed(() => new Map((text.value?.turns ?? []).map((t) => [t.id, t])));
const speakerLabel = (speakerId: string) =>
  text.value?.speakers.find((s) => s.id === speakerId)?.label ?? speakerId;

const droppedText = (n: number) =>
  n === 1
    ? "1 quote couldn't be verified against the transcript and was left out."
    : `${n} quotes couldn't be verified against the transcript and were left out.`;

/** "14 Sept 2026 · 01:32:10 · German, translated". A language that is not known is left out ("Translated"). */
const meta = computed(() => {
  const t = text.value;
  if (!t) return '';
  const name = languageName(t.languageCode);
  const translated = isTranslatedSession(t);
  const language = name
    ? name + (translated ? ', translated' : '')
    : translated
      ? 'Translated'
      : null;
  return [
    formatDate(t.recordedAt),
    t.durationSec === null ? null : formatTimestamp(t.durationSec),
    language,
  ]
    .filter(Boolean)
    .join(' · ');
});

/** The overview's paragraphs: while editing, the editor's (an emptied one stays until it's left). */
const overview = computed(() =>
  editing.value
    ? paragraphs.value
    : overviewParagraphs(summary.value?.overview ?? '').map((text, i) => ({ id: i, text })),
);

/** An entry's quotes as cards, each checked against the transcript as it is now. */
function quoteCards(quotes: readonly SummaryQuote[]) {
  const t = text.value;
  const s = session.value;
  if (!t || !s) return [];
  return quotes.map((q, i) => {
    const turn = turns.value.get(q.turnId);
    const english = turn ? englishText(t, turn) : null;
    const check = english !== null ? checkQuote(english, q.text) : null;
    const shown = check?.status === 'verified' ? check.sourceText : q.text;
    const speaker = turn ? speakerLabel(turn.speakerId) : null;
    const start = turn?.start ?? null;
    const translatedFrom = turn && turn.en !== null && !isEnglishSession(t) ? t.languageCode : null;
    const parts: CitationParts | null =
      check?.status === 'verified' && speaker !== null && start !== null
        ? { text: shown, speakerLabel: speaker, start, sessionTitle: s.title, translatedFrom }
        : null;
    return {
      key: `${q.turnId}-${i}`,
      text: shown,
      check: check?.status ?? 'not_found',
      speaker,
      start,
      translatedFrom,
      citation: parts ? formatCitation(parts) : null,
      at: turn ? { sessionId: s.sessionId, turnId: turn.id } : null,
    };
  });
}

const questions = computed(() =>
  (summary.value?.researchQuestions ?? []).map((q, i) => ({
    ...q,
    place: { kind: 'question', index: i } as const,
    cards: quoteCards(q.quotes),
  })),
);

const themes = computed(() =>
  (summary.value?.themes ?? []).map((t, i) => ({
    ...t,
    place: { kind: 'theme', index: i } as const,
    cards: quoteCards(t.quotes),
  })),
);

const madeWith = computed(() => {
  const f = file.value;
  if (!f) return '';
  const model = projectModelLabel(f.model);
  const date = Date.parse(f.createdAt);
  return Number.isNaN(date) ? `Made with ${model}` : `Made with ${model} on ${formatDate(date)}`;
});

// --- Editing --------------------------------------------------------------------------------------

/** The question's first words, to name its finding's block. */
const QUESTION_WORDS = 6;
function shortQuestion(question: string): string {
  const words = question.trim().split(/\s+/);
  return words.slice(0, QUESTION_WORDS).join(' ') + (words.length > QUESTION_WORDS ? '…' : '');
}

const pendingAt = (place: QuotePlace) =>
  pendingQuote.value?.kind === place.kind && pendingQuote.value.index === place.index;
/** **Add quote** is offered while an entry has room for another (hidden, not disabled: D13). */
const canAddQuote = (place: QuotePlace, quotes: readonly SummaryQuote[]) =>
  editing.value && !pendingAt(place) && quotes.length < SUMMARY_LIMITS.quotesPerEntry;

const announcement = ref('');

async function toggleEditing(): Promise<void> {
  if (editing.value) {
    if (await edit.done()) announcement.value = 'Editing finished';
    return;
  }
  if (await edit.start(props.sessionId)) announcement.value = 'Editing';
}

// Selecting another session or leaving Project mode ends editing, once what was typed is saved.
onBeforeUnmount(() => {
  if (edit.isEditing(props.sessionId)) void edit.stop();
});

// --- Actions --------------------------------------------------------------------------------------

const keyDialog = ref(false);
const working = computed(() => status.value === 'running' || status.value === 'queued');
const openError = ref('');

function summarise(): void {
  if (pipeline.needsKey) {
    keyDialog.value = true;
    return;
  }
  void pipeline.summarise([props.sessionId]);
}

function onKeyConfirmed(): void {
  keyDialog.value = false;
  void pipeline.summarise([props.sessionId]);
}

async function openTranscript(): Promise<void> {
  openError.value = '';
  openError.value = (await opener.openTranscript(props.sessionId)) ?? '';
}

// The heading takes focus when a session is picked in the list, so keyboard and screen-reader users land on it. Not
// when Analyse mode opens with a session still selected: the view's own heading has focus then.
async function focusHeading(): Promise<void> {
  await nextTick();
  if (document.activeElement?.closest('[role="listbox"]')) heading.value?.focus();
}
onMounted(focusHeading);
watch(
  () => props.sessionId,
  (_, before) => {
    openError.value = '';
    announcement.value = '';
    if (before !== undefined && edit.isEditing(before)) void edit.stop();
    void focusHeading();
  },
);
</script>

<template>
  <article
    v-if="session"
    ref="article"
    class="session-summary"
    lang="en"
    :aria-labelledby="`${id}-title`"
    @keydown="onKeydown"
  >
    <button type="button" class="link-button back back-sessions" @click="emit('back')">
      Sessions
    </button>

    <header class="head">
      <h2
        :id="`${id}-title`"
        ref="heading"
        v-block-text="{ text: (editing && summary?.title) || session.title, version }"
        class="title"
        :tabindex="editing ? undefined : -1"
        v-bind="blockAttrs({ kind: 'title' }, 'Title')"
        v-on="blockEvents"
      />
      <p class="meta">{{ meta }}</p>
      <div class="head-actions">
        <button
          type="button"
          class="button button-icon"
          aria-label="Open transcript"
          :disabled="!opener.canOpen(sessionId)"
          @click="openTranscript"
        >
          <IconOpen />
          <span class="icon-tip" aria-hidden="true">Open transcript</span>
        </button>
        <button
          v-if="file && !working"
          ref="editButton"
          type="button"
          class="button button-icon"
          :class="{ 'is-on': editing }"
          :aria-label="editing ? 'Done' : 'Edit'"
          @click="toggleEditing"
        >
          <IconEdit />
          <span class="icon-tip" aria-hidden="true">{{ editing ? 'Done' : 'Edit' }}</span>
        </button>
      </div>
      <p v-if="openError" class="error" role="alert">{{ openError }}</p>
      <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    </header>

    <FolderNotice v-if="editing" source="summary" />

    <div v-if="working" class="status">
      <PipelineStatus :session-id="sessionId" :show-failure="false" />
    </div>
    <div v-else-if="status === 'failed' && failure" class="status status-failed">
      <p role="alert">{{ failure.error.userMessage }}</p>
      <button v-if="!editing" type="button" class="button" @click="summarise">Try again</button>
      <ErrorDetails :error="failure.error" />
    </div>
    <div v-else-if="status === 'stale'" class="status">
      <p>Out of date: the transcript or the brief has changed.</p>
      <button v-if="!editing" type="button" class="button" @click="summarise">Regenerate</button>
    </div>
    <div v-else-if="status === 'none'" class="status">
      <p>No summary yet.</p>
      <button type="button" class="button button-primary" @click="summarise">Summarise</button>
    </div>

    <template v-if="summary">
      <p
        v-block-text="{ text: summary.synopsis, version }"
        class="synopsis"
        v-bind="blockAttrs({ kind: 'synopsis' }, 'Synopsis')"
        v-on="blockEvents"
      />

      <section v-if="overview.length > 0" class="section" :aria-labelledby="`${id}-overview`">
        <h3 :id="`${id}-overview`">Overview</h3>
        <p
          v-for="(paragraph, i) in overview"
          :key="paragraph.id"
          v-block-text="{ text: paragraph.text, version }"
          v-bind="blockAttrs({ kind: 'overview', index: i }, `Overview, paragraph ${i + 1}`, true)"
          v-on="blockEvents"
        />
      </section>

      <section
        v-if="summary.respondents.length > 0"
        class="section"
        :aria-labelledby="`${id}-respondents`"
      >
        <h3 :id="`${id}-respondents`">Respondents</h3>
        <div v-for="(r, i) in summary.respondents" :key="i" class="respondent">
          <h4
            v-block-text="{ text: r.label, version }"
            class="respondent-name"
            v-bind="blockAttrs({ kind: 'respondent', index: i }, 'Respondent')"
            v-on="blockEvents"
          />
          <dl v-if="r.attributes.length > 0" class="attributes">
            <div v-for="(a, j) in r.attributes" :key="j">
              <!-- The block is inside the dt and dd, so the list keeps its terms and details for screen readers. -->
              <dt>
                <span
                  v-block-text="{ text: a.field, version }"
                  v-bind="
                    blockAttrs({ kind: 'field', respondent: i, index: j }, `Detail of ${r.label}`)
                  "
                  v-on="blockEvents"
                />
              </dt>
              <dd>
                <span
                  v-block-text="{ text: a.value, version }"
                  v-bind="
                    blockAttrs(
                      { kind: 'value', respondent: i, index: j },
                      `${a.field.trim() || 'Detail'} of ${r.label}`,
                    )
                  "
                  v-on="blockEvents"
                />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section v-if="questions.length > 0" class="section" :aria-labelledby="`${id}-questions`">
        <h3 :id="`${id}-questions`">Research questions</h3>
        <ol class="questions">
          <li v-for="(q, i) in questions" :key="i">
            <p class="question">{{ q.question }}</p>
            <p
              v-block-text="{ text: q.finding, version }"
              :class="{ muted: q.finding === NOT_DISCUSSED }"
              v-bind="
                blockAttrs({ kind: 'finding', index: i }, `Finding: ${shortQuestion(q.question)}`)
              "
              v-on="blockEvents"
            />
            <ul v-if="q.cards.length > 0 || pendingAt(q.place)" class="quotes">
              <li v-for="(c, k) in q.cards" :key="c.key">
                <QuoteCard
                  :text="c.text"
                  :check="c.check"
                  :speaker="c.speaker"
                  :start="c.start"
                  :translated-from="c.translatedFrom"
                  :citation="c.citation"
                  :at="c.at"
                  :removable="editing"
                  @remove="onRemoveQuote(q.place, k)"
                />
              </li>
              <li v-if="pendingAt(q.place)">
                <blockquote
                  class="quote-draft"
                  v-bind="blockAttrs({ kind: 'quote' }, 'New quote')"
                  v-on="blockEvents"
                />
              </li>
            </ul>
            <button
              v-if="canAddQuote(q.place, q.quotes)"
              type="button"
              class="link-button entry-action"
              @click="onAddQuote(q.place)"
            >
              Add quote
            </button>
          </li>
        </ol>
      </section>

      <section
        v-if="themes.length > 0 || editing"
        class="section"
        :aria-labelledby="`${id}-themes`"
      >
        <h3 :id="`${id}-themes`">Themes</h3>
        <dl v-if="themes.length > 0" class="themes">
          <div v-for="(t, i) in themes" :key="i">
            <dt class="theme-head">
              <div
                v-block-text="{ text: t.name, version }"
                class="theme-name"
                v-bind="blockAttrs({ kind: 'themeName', index: i }, `Name of theme ${i + 1}`)"
                v-on="blockEvents"
              />
              <button
                v-if="editing"
                type="button"
                class="icon-button"
                :aria-label="`Remove theme: ${t.name.trim() || `theme ${i + 1}`}`"
                @click="onRemoveTheme(i)"
              >
                <IconRemove class="icon" />
                <span class="icon-tip" aria-hidden="true">Remove theme</span>
              </button>
            </dt>
            <dd>
              <div
                v-block-text="{ text: t.description, version }"
                v-bind="
                  blockAttrs(
                    { kind: 'themeDescription', index: i },
                    `Description of ${t.name.trim() || `theme ${i + 1}`}`,
                  )
                "
                v-on="blockEvents"
              />
              <ul v-if="t.cards.length > 0 || pendingAt(t.place)" class="quotes">
                <li v-for="(c, k) in t.cards" :key="c.key">
                  <QuoteCard
                    :text="c.text"
                    :check="c.check"
                    :speaker="c.speaker"
                    :start="c.start"
                    :translated-from="c.translatedFrom"
                    :citation="c.citation"
                    :at="c.at"
                    :removable="editing"
                    @remove="onRemoveQuote(t.place, k)"
                  />
                </li>
                <li v-if="pendingAt(t.place)">
                  <blockquote
                    class="quote-draft"
                    v-bind="blockAttrs({ kind: 'quote' }, 'New quote')"
                    v-on="blockEvents"
                  />
                </li>
              </ul>
              <button
                v-if="canAddQuote(t.place, t.quotes)"
                type="button"
                class="link-button entry-action"
                @click="onAddQuote(t.place)"
              >
                Add quote
              </button>
            </dd>
          </div>
        </dl>
        <button v-if="editing" type="button" class="button add-theme" @click="onAddTheme">
          <IconAdd class="icon" />
          Add theme
        </button>
      </section>

      <details class="details">
        <summary>Details</summary>
        <div class="details-body">
          <p>{{ madeWith }}</p>
          <p v-if="file && file.droppedQuotes > 0">{{ droppedText(file.droppedQuotes) }}</p>
          <p v-for="copy in session.copies" :key="copy">
            Another copy: <span class="file">{{ copy }}</span>
          </p>
          <div v-if="status === 'ok' && !editing">
            <button type="button" class="button" @click="summarise">Regenerate</button>
          </div>
        </div>
      </details>
    </template>

    <SummariseDialog
      :open="keyDialog"
      title="Summarise"
      message=""
      confirm-label="Summarise"
      :translates="status !== 'ok' && !!text && lacksEnglish(text)"
      @confirm="onKeyConfirmed"
      @cancel="keyDialog = false"
    />
  </article>
</template>

<style scoped>
.session-summary {
  display: grid;
  gap: var(--space-5);
  align-content: start;
  min-width: 0;
}

.back {
  justify-self: start;
}

.back-sessions {
  display: none;
}

.back::before {
  content: '←' / '';
  margin-right: var(--space-1);
}

.head {
  display: grid;
  gap: var(--space-2);
}

.title {
  font-size: var(--font-size-xl);
  line-height: 1.2;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.error {
  color: var(--color-danger);
}

.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  --color-button: var(--color-bg);
}

.status-failed p {
  color: var(--color-danger);
}

.synopsis {
  font-size: var(--font-size-md);
  line-height: 1.5;
}

.section {
  display: grid;
  gap: var(--space-2);
}

.section h3 {
  font-size: var(--font-size-md);
  font-weight: 600;
}

.respondent {
  display: grid;
  gap: var(--space-1);
}

.respondent-name {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.attributes,
.themes {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.attributes div {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}

.attributes dt {
  color: var(--color-text-muted);
}

.attributes dt::after {
  content: ':';
}

.attributes dd,
.themes dd {
  margin: 0;
}

.themes > div {
  display: grid;
  gap: 0.125rem;
  padding-bottom: var(--space-2);
}

.themes dt {
  font-weight: 600;
}

/* The theme's name, with Remove theme at the end of its row while editing. */
.theme-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.theme-name {
  flex: 1;
  min-width: 0;
}

.themes dd {
  display: grid;
}

.questions,
.quotes {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.questions {
  gap: var(--space-3);
}

/* An entry's quotes, under its finding or description. */
.quotes {
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.question {
  font-weight: 600;
}

.muted {
  color: var(--color-text-muted);
}

.details summary {
  color: var(--color-text-muted);
  cursor: pointer;
}

.details-body {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.file {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

/* Editing (Phase 39): the text stays where it is, in the same type. The block with the caret is tinted; there are no
   boxes around the others. */
[data-block] {
  min-height: 1lh;
  border-radius: var(--radius-sm);
  outline: none;
  box-shadow: 0 0 0 var(--space-1) transparent;
  transition:
    background-color 0.15s,
    box-shadow 0.15s;
}

/* Pointed at: a light grey shows which piece of text a click goes into. */
@media (hover: hover) {
  [data-block]:hover:not(:focus) {
    background: var(--color-surface);
    box-shadow: 0 0 0 var(--space-1) var(--color-surface);
  }
}

[data-block]:focus {
  background: var(--color-button-hover);
  box-shadow: 0 0 0 var(--space-1) var(--color-button-hover);
}

/* A quote being added, typed or pasted, styled as the card it will become. */
.quote-draft {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.quote-draft:focus {
  box-shadow: none;
}

/* A respondent's detail is inline, as when it's read; an emptied one keeps a place to click. */
.attributes [data-block] {
  display: inline-block;
  min-width: 2ch;
}

.entry-action,
.add-theme {
  justify-self: start;
  margin-top: var(--space-2);
}

/* Add theme: a button, with the plus that says what it does. */
.add-theme .icon {
  flex: none;
  width: 1.25em;
  height: 1.25em;
}

/* Add quote: smaller than the text it adds to, as the quote cards' captions are. */
.entry-action {
  font-size: var(--font-size-sm);
}

/* Remove theme: icon only; its name is the aria-label, and a tip says it on pointing (.icon-tip, base.css). The
   negative margin keeps the name's row as tall as when it's read. */
.icon-button {
  position: relative;
  display: inline-flex;
  flex: none;
  margin-block: calc(-1 * var(--space-1));
  padding: var(--space-1);
  border: 0;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.icon-button:hover {
  color: var(--color-danger);
}

.icon-button .icon {
  width: 1.25em;
  height: 1.25em;
}

/* While editing, Edit (named Done) shows it is on. */
.is-on {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

@media (prefers-reduced-motion: reduce) {
  [data-block] {
    transition: none;
  }
}

/* In a narrow window the summary takes the list's place, and the way back is to the list (the chat is below it). */
@media (max-width: 48rem) {
  .back-sessions {
    display: inline-flex;
  }
}
</style>

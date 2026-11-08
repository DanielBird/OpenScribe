<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import { formatCitation, type CitationParts } from '../../domain/corpus/citation';
import { checkQuote } from '../../domain/corpus/quoteCheck';
import {
  englishText,
  isEnglishSession,
  isTranslatedSession,
  lacksEnglish,
} from '../../domain/corpus/sessionText';
import { NOT_DISCUSSED, type SummaryQuote } from '../../domain/summary';
import { formatDate, formatTimestamp, languageName } from '../../domain/transcript';
import { projectModelLabel } from '../../providers/llm/models';
import { useNavStore } from '../../stores/nav';
import { usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useTranscriptStore } from '../../stores/transcript';
import { useConfirm } from '../composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';
import ErrorDetails from './ErrorDetails.vue';
import PipelineStatus from './PipelineStatus.vue';
import QuoteCard from './QuoteCard.vue';
import SummariseDialog from './SummariseDialog.vue';

// The selected session's summary in Project mode (PROJECTS.md §5.6): its status and what to do about it, then the
// summary itself. Summaries are read only (A11); **Regenerate** makes a new one. Every quote is checked against the
// transcript as it is now, and only a quote that is found can be copied (T13).
const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ back: [] }>();

const project = useProjectStore();
const pipeline = usePipelineStore();
const transcript = useTranscriptStore();
const nav = useNavStore();
const { confirm, dialog } = useConfirm();
const id = useId();
const heading = useTemplateRef<HTMLElement>('heading');

const session = computed(() => project.session(props.sessionId) ?? null);
const status = computed(() => pipeline.statusOf(props.sessionId));
const failure = computed(() => pipeline.failureFor(props.sessionId));
const file = computed(() => session.value?.summary ?? null);
const summary = computed(() => file.value?.summary ?? null);
const text = computed(() => session.value?.text ?? null);

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

const overview = computed(() =>
  (summary.value?.overview ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean),
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
    };
  });
}

const questions = computed(() =>
  (summary.value?.researchQuestions ?? []).map((q) => ({ ...q, cards: quoteCards(q.quotes) })),
);

const themes = computed(() =>
  (summary.value?.themes ?? []).map((t) => ({ ...t, cards: quoteCards(t.quotes) })),
);

const madeWith = computed(() => {
  const f = file.value;
  if (!f) return '';
  const model = projectModelLabel(f.model);
  const date = Date.parse(f.createdAt);
  return Number.isNaN(date) ? `Made with ${model}` : `Made with ${model} on ${formatDate(date)}`;
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
  const current = transcript.doc;
  if (current?.id === props.sessionId && transcript.projectLink) {
    nav.goTo('output');
    return;
  }
  if (current && (!transcript.projectLink || transcript.folderNotice)) {
    const ok = await confirm({
      title: 'Replace the transcript on Output?',
      message: transcript.projectLink
        ? "Its latest changes aren't saved in its project."
        : "It isn't in a project, and is saved only in this browser.",
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
  }
  try {
    await transcript.openFromProject(props.sessionId);
    nav.goTo('output');
  } catch (err) {
    openError.value =
      err instanceof Error && 'userMessage' in err && typeof err.userMessage === 'string'
        ? err.userMessage
        : "DeScribe couldn't open this transcript. Try again.";
  }
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
  () => {
    openError.value = '';
    void focusHeading();
  },
);
</script>

<template>
  <article v-if="session" class="session-summary" :aria-labelledby="`${id}-title`">
    <button type="button" class="link-button back back-sessions" @click="emit('back')">
      Sessions
    </button>

    <header class="head">
      <h2 :id="`${id}-title`" ref="heading" class="title" tabindex="-1">{{ session.title }}</h2>
      <p class="meta">{{ meta }}</p>
      <div class="head-actions">
        <button
          type="button"
          class="button"
          :disabled="status === 'running'"
          @click="openTranscript"
        >
          Open transcript
        </button>
      </div>
      <p v-if="openError" class="error" role="alert">{{ openError }}</p>
    </header>

    <div v-if="working" class="status">
      <PipelineStatus :session-id="sessionId" :show-failure="false" />
    </div>
    <div v-else-if="status === 'failed' && failure" class="status status-failed">
      <p role="alert">{{ failure.error.userMessage }}</p>
      <button type="button" class="button" @click="summarise">Try again</button>
      <ErrorDetails :error="failure.error" />
    </div>
    <div v-else-if="status === 'stale'" class="status">
      <p>Out of date: the transcript or the brief has changed.</p>
      <button type="button" class="button" @click="summarise">Regenerate</button>
    </div>
    <div v-else-if="status === 'none'" class="status">
      <p>No summary yet.</p>
      <button type="button" class="button button-primary" @click="summarise">Summarise</button>
    </div>

    <template v-if="summary">
      <p class="synopsis">{{ summary.synopsis }}</p>

      <section v-if="overview.length > 0" class="section" :aria-labelledby="`${id}-overview`">
        <h3 :id="`${id}-overview`">Overview</h3>
        <p v-for="(paragraph, i) in overview" :key="i">{{ paragraph }}</p>
      </section>

      <section
        v-if="summary.respondents.length > 0"
        class="section"
        :aria-labelledby="`${id}-respondents`"
      >
        <h3 :id="`${id}-respondents`">Respondents</h3>
        <div v-for="(r, i) in summary.respondents" :key="i" class="respondent">
          <h4 class="respondent-name">{{ r.label }}</h4>
          <dl v-if="r.attributes.length > 0" class="attributes">
            <div v-for="(a, j) in r.attributes" :key="j">
              <dt>{{ a.field }}</dt>
              <dd>{{ a.value }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section v-if="questions.length > 0" class="section" :aria-labelledby="`${id}-questions`">
        <h3 :id="`${id}-questions`">Research questions</h3>
        <ol class="questions">
          <li v-for="(q, i) in questions" :key="i">
            <p class="question">{{ q.question }}</p>
            <p :class="{ muted: q.finding === NOT_DISCUSSED }">{{ q.finding }}</p>
            <ul v-if="q.cards.length > 0" class="quotes">
              <li v-for="c in q.cards" :key="c.key">
                <QuoteCard
                  :text="c.text"
                  :check="c.check"
                  :speaker="c.speaker"
                  :start="c.start"
                  :translated-from="c.translatedFrom"
                  :citation="c.citation"
                />
              </li>
            </ul>
          </li>
        </ol>
      </section>

      <section v-if="themes.length > 0" class="section" :aria-labelledby="`${id}-themes`">
        <h3 :id="`${id}-themes`">Themes</h3>
        <dl class="themes">
          <div v-for="(t, i) in themes" :key="i">
            <dt>{{ t.name }}</dt>
            <dd>
              {{ t.description }}
              <ul v-if="t.cards.length > 0" class="quotes">
                <li v-for="c in t.cards" :key="c.key">
                  <QuoteCard
                    :text="c.text"
                    :check="c.check"
                    :speaker="c.speaker"
                    :start="c.start"
                    :translated-from="c.translatedFrom"
                    :citation="c.citation"
                  />
                </li>
              </ul>
            </dd>
          </div>
        </dl>
      </section>

      <details class="details">
        <summary>Details</summary>
        <div class="details-body">
          <p>{{ madeWith }}</p>
          <p v-if="file && file.droppedQuotes > 0">{{ droppedText(file.droppedQuotes) }}</p>
          <p v-for="copy in session.copies" :key="copy">
            Another copy: <span class="file">{{ copy }}</span>
          </p>
          <div v-if="status === 'ok'">
            <button type="button" class="button" @click="summarise">Regenerate</button>
          </div>
        </div>
      </details>
    </template>

    <ConfirmDialog v-bind="dialog" />
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

.themes div {
  display: grid;
  gap: 0.125rem;
  padding-bottom: var(--space-2);
}

.themes dt {
  font-weight: 600;
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

/* In a narrow window the summary takes the list's place, and the way back is to the list (the chat is below it). */
@media (max-width: 48rem) {
  .back-sessions {
    display: inline-flex;
  }
}
</style>

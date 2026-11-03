import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from 'vue';
import {
  lacksEnglish,
  toSessionText,
  transcriptHash,
  type SessionText,
} from '../domain/corpus/sessionText';
import { briefHash } from '../domain/project';
import { SUMMARY_SCHEMA_VERSION, type SessionSummaryFile } from '../domain/summary';
import { normalizeLanguage, type LlmProviderId, type TranscriptDoc } from '../domain/transcript';
import { staleTurnIds, type TranslationTexts } from '../domain/translation';
import { summariseSession } from '../features/summary/summarise';
import { TranslationError, translateTranscript } from '../features/translation/translate';
import { ProviderError } from '../providers/errors';
import { getLlmProvider } from '../providers/index';
import type { LlmProvider } from '../providers/llm/types';
import { FOLDER_MESSAGES, FolderError } from '../storage/folder';
import { useProjectStore, type FileSummaryStatus } from './project';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';
import { createUnloadGuard } from './unloadGuard';

export type PipelineStep = 'save' | 'translate' | 'summarise';
export type PipelineError = ProviderError | FolderError;
export type SummaryStatus = FileSummaryStatus | 'queued' | 'running' | 'failed';

/** One session's way through the pipeline: Add to project (save first), or Summarise / Regenerate. */
export interface PipelineJob {
  sessionId: string;
  title: string;
  /** `add`: from Output, starting with the save. */
  kind: 'add' | 'summarise';
  steps: PipelineStep[];
  current: PipelineStep | null;
  /** During `translate`. */
  progress: { batch: number; totalBatches: number } | null;
  status: 'queued' | 'running';
}

/** The last attempt on this computer failed (never written to the folder). Resume starts from `step`. */
export interface PipelineFailure {
  sessionId: string;
  title: string;
  kind: PipelineJob['kind'];
  steps: PipelineStep[];
  step: PipelineStep;
  error: PipelineError;
  /** Access to the project folder ended: **Reconnect** before Resume. */
  reconnect: boolean;
  /**
   * Turns translated before a failed translation, so Resume doesn't pay for them again: those whose text hasn't
   * changed since (DECISIONS.md D39).
   */
  partial: TranslationTexts | null;
}

export const PIPELINE_MESSAGES = {
  keyMissing: {
    claude: 'Enter your Claude API key first.',
    gemini: 'Enter your Gemini API key first.',
  } satisfies Record<LlmProviderId, string>,
  notOpen: "This transcript isn't open any more. Open it again, then try again.",
  unexpected: 'Something went wrong. Try again.',
} as const;

interface JobRecord extends Omit<PipelineJob, 'progress'> {
  partial: TranslationTexts | null;
}

/**
 * True when the language isn't English and some turn has no current English text: never translated, or changed
 * since (DECISIONS.md D39).
 */
export function needsTranslation(doc: TranscriptDoc): boolean {
  if (normalizeLanguage(doc.result.languageCode) === 'en') return false;
  return !doc.translations.en || staleTurnIds(doc).length > 0;
}

/**
 * Errors that would fail every session after this one too: stop the queue. Google doesn't document how to tell a spent
 * daily quota from a rate limit, so a Gemini rate limit stops it too (DECISIONS.md T15); the SDK has already retried.
 */
function stopsQueue(error: PipelineError, provider: LlmProviderId): boolean {
  if (!(error instanceof ProviderError)) return error.kind === 'permission';
  return (
    error.kind === 'auth' ||
    error.kind === 'quota' ||
    (provider === 'gemini' && error.kind === 'rate_limit')
  );
}

function asPipelineError(err: unknown): PipelineError {
  if (err instanceof TranslationError) return err.cause;
  if (err instanceof ProviderError || err instanceof FolderError) return err;
  return new ProviderError('unknown', PIPELINE_MESSAGES.unexpected, {
    detail: err instanceof Error ? err.message : undefined,
  });
}

/** Asks before the page is left or reloaded while work would be lost. */
const unloadGuard = createUnloadGuard();

// Add to project and session summaries (PROJECTS.md §5.3, Phase 15): one job at a time, from a queue.
//   queued ──▶ running ──done──▶ (removed; the summary file is in the folder)
//                 │ error: a failure is kept (statusOf → 'failed'); `auth`, `quota` or a lost folder stops the queue
//                 │ cancel: the queue is cleared; what was saved stays saved
// Resume (or Summarise again) continues a failed session from the step that failed.
export const usePipelineStore = defineStore('pipeline', () => {
  const project = useProjectStore();
  const transcript = useTranscriptStore();
  const settings = useSettingsStore();

  const jobs = shallowRef<JobRecord[]>([]);
  const progress = ref<{ batch: number; totalBatches: number } | null>(null);
  const failures = shallowRef<ReadonlyMap<string, PipelineFailure>>(new Map());
  /** The session that failed last, for **Resume**. */
  const lastFailed = ref<string | null>(null);
  /** The error that stopped the queue, until the next start. */
  const stopped = shallowRef<PipelineError | null>(null);
  /** Jobs finished (or failed) out of those queued since the queue was last empty: "Summarising 3 of 12". */
  const queueProgress = ref({ done: 0, total: 0 });

  const current = computed<PipelineJob | null>(() => {
    const job = jobs.value.find((j) => j.status === 'running');
    return job ? view(job, progress.value) : null;
  });
  const queued = computed<readonly PipelineJob[]>(() =>
    jobs.value.filter((j) => j.status === 'queued').map((j) => view(j, null)),
  );
  const isBusy = computed(() => jobs.value.length > 0);

  /** The project provider's key is missing, or the last attempt said it doesn't work. */
  const needsKey = computed(
    () =>
      settings.keyFor(settings.projectProvider).trim() === '' ||
      [...failures.value.values()].some(
        (f) => f.error instanceof ProviderError && f.error.kind === 'auth',
      ),
  );

  /** Sessions that **Summarise all** would summarise: no summary, out of date, or failed. */
  const summariseAllIds = computed(() =>
    project.sessions
      .map((s) => s.sessionId)
      .filter((id) => {
        const status = statusOf(id);
        return status === 'none' || status === 'stale' || status === 'failed';
      }),
  );

  function view(job: JobRecord, p: PipelineJob['progress']): PipelineJob {
    const { partial: _partial, ...rest } = job;
    return { ...rest, progress: p };
  }

  function statusOf(sessionId: string): SummaryStatus {
    const job = jobs.value.find((j) => j.sessionId === sessionId);
    if (job) return job.status;
    if (failures.value.has(sessionId)) return 'failed';
    return project.session(sessionId)?.status ?? 'none';
  }

  function jobFor(sessionId: string): PipelineJob | null {
    const job = jobs.value.find((j) => j.sessionId === sessionId);
    if (!job) return null;
    return view(job, job.status === 'running' ? progress.value : null);
  }

  function failureFor(sessionId: string): PipelineFailure | null {
    return failures.value.get(sessionId) ?? null;
  }

  function setFailure(sessionId: string, failure: PipelineFailure | null): void {
    const next = new Map(failures.value);
    if (failure) next.set(sessionId, failure);
    else next.delete(sessionId);
    failures.value = next;
  }

  function replace(job: JobRecord, patch: Partial<JobRecord>): JobRecord {
    const next = { ...job, ...patch };
    jobs.value = jobs.value.map((j) => (j === job ? next : j));
    return next;
  }

  function remove(job: JobRecord): void {
    jobs.value = jobs.value.filter((j) => j !== job);
  }

  // --- Running ------------------------------------------------------------------------------------

  let controller: AbortController | null = null;
  let idleWaiters: (() => void)[] = [];

  /** Resolves once nothing is queued or running. */
  function whenIdle(): Promise<void> {
    if (jobs.value.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function settleIdle(): void {
    unloadGuard.release();
    queueProgress.value = { done: 0, total: 0 };
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Starts the next queued job, if nothing is running. */
  function pump(): void {
    if (controller) return;
    const next = jobs.value.find((j) => j.status === 'queued');
    if (!next) {
      settleIdle();
      return;
    }
    unloadGuard.hold();
    void run(next);
  }

  /** True when the session is open on Output and linked to its file: work goes through the transcript store. */
  function isOpenOnOutput(sessionId: string): boolean {
    return transcript.doc?.id === sessionId && transcript.projectLink?.docId === sessionId;
  }

  /** Saving the open transcript to the folder has stopped: the folder doesn't have what was just made. */
  function folderProblem(): FolderError | null {
    if (transcript.folderConflict) return new FolderError('changed', FOLDER_MESSAGES.changed);
    return transcript.folderSaveError;
  }

  async function run(start: JobRecord): Promise<void> {
    const ctrl = new AbortController();
    controller = ctrl;
    let job = replace(start, { status: 'running' });
    progress.value = null;
    // Read the provider and its key now, not when queued: Resume after an auth error uses the corrected key.
    const providerId = settings.projectProvider;
    // Cancel or another project makes this run stale: its results are ignored.
    const isCurrent = () => controller === ctrl && !ctrl.signal.aborted;

    try {
      const apiKey = settings.keyFor(providerId).trim();
      if (apiKey === '') {
        throw new ProviderError('auth', PIPELINE_MESSAGES.keyMissing[providerId]);
      }
      if (project.status !== 'ready' || !project.project) {
        throw new FolderError('permission', FOLDER_MESSAGES.permission);
      }
      const model = settings.projectModel;
      const provider = getLlmProvider(providerId, apiKey, model);
      const first = job.current ? job.steps.indexOf(job.current) : 0;

      for (const step of job.steps.slice(Math.max(first, 0))) {
        job = replace(job, { current: step });
        progress.value = null;
        if (step === 'save') {
          await saveStep(job);
        } else if (step === 'translate') {
          await translateStep(job, provider, model, ctrl.signal, isCurrent, (partial) => {
            if (isCurrent()) job = replace(job, { partial });
          });
        } else {
          await summariseStep(job, provider, model, ctrl.signal);
        }
        if (!isCurrent()) return;
      }

      remove(job);
      setFailure(job.sessionId, null);
      queueProgress.value = { ...queueProgress.value, done: queueProgress.value.done + 1 };
    } catch (err) {
      if (!isCurrent()) return;
      const error = asPipelineError(err);
      const latest = jobs.value.find((j) => j.sessionId === job.sessionId) ?? job;
      setFailure(job.sessionId, {
        sessionId: job.sessionId,
        title: job.title,
        kind: job.kind,
        steps: job.steps,
        step: latest.current ?? job.steps[0] ?? 'summarise',
        error,
        reconnect: error instanceof FolderError && error.kind === 'permission',
        partial: err instanceof TranslationError ? err.completed : latest.partial,
      });
      lastFailed.value = job.sessionId;
      remove(latest);
      if (stopsQueue(error, providerId)) {
        stopped.value = error;
        jobs.value = [];
      } else {
        queueProgress.value = { ...queueProgress.value, done: queueProgress.value.done + 1 };
      }
    } finally {
      if (controller === ctrl) {
        controller = null;
        progress.value = null;
        pump();
      }
    }
  }

  async function saveStep(job: JobRecord): Promise<void> {
    if (transcript.doc?.id !== job.sessionId) {
      throw new ProviderError('validation', PIPELINE_MESSAGES.notOpen);
    }
    await transcript.addToProject();
  }

  /**
   * Translates the session to English with the project model, unless all its English text is current. Only the
   * batches with a turn that has none, or changed since it was translated, are sent (DECISIONS.md D39). The
   * translation goes into the transcript file: through the Output tab when the session is open there, otherwise
   * straight into the file. `keep` gets the texts before they are saved, so Resume doesn't pay for them again.
   */
  async function translateStep(
    job: JobRecord,
    provider: LlmProvider,
    model: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
    keep: (partial: TranslationTexts | null) => void,
  ): Promise<void> {
    const open = isOpenOnOutput(job.sessionId);
    const source = open ? toRaw(transcript.doc) : (await project.readSessionDoc(job.sessionId)).doc;
    if (!source || !needsTranslation(source)) return;

    const result = await translateTranscript(source, provider, {
      signal,
      // Only English whose turn still has the text it was made from is kept; the other batches are sent.
      resumeFrom: job.partial ?? source.translations.en,
      onProgress: (p) => {
        if (isCurrent()) progress.value = p;
      },
    });
    if (!isCurrent()) return;
    keep(result);
    const translation = {
      provider: provider.id,
      model,
      createdAt: new Date().toISOString(),
      ...result,
    };

    if (open && (await transcript.setTranslation(job.sessionId, translation))) {
      const problem = folderProblem();
      if (problem) throw problem;
    } else {
      // Not open on Output, or replaced there meanwhile: write the file, if it still holds the text that was
      // translated and nobody changes it before the write.
      const read = await project.readSessionDoc(job.sessionId);
      if (transcriptHash(read.doc) !== transcriptHash(source)) {
        // Changed during the translation: Resume translates again only the turns whose text changed, which
        // `result.sourceHashes` tells it.
        throw new FolderError('changed', FOLDER_MESSAGES.changed);
      }
      const doc: TranscriptDoc = {
        ...read.doc,
        translations: { ...read.doc.translations, en: translation },
      };
      await project.saveSessionTranscript(doc, read.name, read.stat);
    }
    keep(null);
  }

  /** Summarises the session's English text and writes the summary file. */
  async function summariseStep(
    job: JobRecord,
    provider: LlmProvider,
    model: string,
    signal: AbortSignal,
  ): Promise<void> {
    let text: SessionText;
    if (isOpenOnOutput(job.sessionId)) {
      await transcript.flush();
      const problem = folderProblem();
      if (problem) throw problem;
      const doc = transcript.doc;
      if (!doc) throw new ProviderError('validation', PIPELINE_MESSAGES.notOpen);
      text = toSessionText(toRaw(doc));
    } else {
      const session = project.session(job.sessionId);
      if (!session) throw new FolderError('not_found', FOLDER_MESSAGES.notFound);
      text = session.text;
    }
    const open = project.project;
    if (!open) throw new FolderError('permission', FOLDER_MESSAGES.permission);
    // The brief sent, not the one current when the reply comes: it may be edited meanwhile.
    const madeWith = briefHash(open.brief);

    const { summary, droppedQuotes } = await summariseSession(text, provider, {
      brief: open.brief,
      projectName: open.name,
      themeVocabulary: project.themesExcept(job.sessionId),
      signal,
    });
    // Cancelled while the reply was on its way: it's ignored.
    if (signal.aborted) return;
    const file: SessionSummaryFile = {
      kind: 'describe.summary',
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      sessionId: job.sessionId,
      createdAt: new Date().toISOString(),
      model,
      provider: provider.id,
      transcriptHash: text.transcriptHash,
      briefHash: madeWith,
      droppedQuotes,
      summary,
    };
    await project.saveSessionSummary(job.sessionId, file);
  }

  // --- Starting -----------------------------------------------------------------------------------

  /** Queues a job; `front` puts it right after the running one. A failed session resumes where it stopped. */
  function enqueue(job: JobRecord, front: boolean): void {
    stopped.value = null;
    const list = jobs.value.slice();
    const at = front ? list.findIndex((j) => j.status === 'queued') : -1;
    if (at === -1) list.push(job);
    else list.splice(at, 0, job);
    jobs.value = list;
    queueProgress.value = { ...queueProgress.value, total: queueProgress.value.total + 1 };
  }

  function fromFailure(failure: PipelineFailure): JobRecord {
    return {
      sessionId: failure.sessionId,
      title: failure.title,
      kind: failure.kind,
      steps: failure.steps,
      current: failure.step,
      status: 'queued',
      partial: failure.partial,
    };
  }

  /**
   * **Add to project** on Output, after the dialog: save, translate if needed, summarise. Resolves when the queue is
   * idle again.
   */
  function addCurrentTranscript(): Promise<void> {
    const doc = transcript.doc;
    if (!doc || jobs.value.some((j) => j.sessionId === doc.id)) return whenIdle();
    const failure = failures.value.get(doc.id);
    enqueue(
      failure
        ? fromFailure(failure)
        : {
            sessionId: doc.id,
            title: doc.source.fileName,
            kind: 'add',
            steps: needsTranslation(doc)
              ? ['save', 'translate', 'summarise']
              : ['save', 'summarise'],
            current: null,
            status: 'queued',
            partial: null,
          },
      true,
    );
    pump();
    return whenIdle();
  }

  /** **Summarise**, **Regenerate** and **Summarise all**: queued one after another. Resolves when idle. */
  function summarise(sessionIds: readonly string[]): Promise<void> {
    for (const id of sessionIds) {
      if (jobs.value.some((j) => j.sessionId === id)) continue;
      const failure = failures.value.get(id);
      if (failure) {
        enqueue(fromFailure(failure), false);
        continue;
      }
      const session = project.session(id);
      if (!session) continue;
      enqueue(
        {
          sessionId: id,
          title: session.title,
          kind: 'summarise',
          steps: lacksEnglish(session.text) ? ['translate', 'summarise'] : ['summarise'],
          current: null,
          status: 'queued',
          partial: null,
        },
        false,
      );
    }
    pump();
    return whenIdle();
  }

  /** Continues the session that failed last (or `sessionId`), from the step that failed. */
  function resume(sessionId?: string): Promise<void> {
    const id = sessionId ?? lastFailed.value;
    const failure = id ? failures.value.get(id) : undefined;
    if (!failure || jobs.value.some((j) => j.sessionId === failure.sessionId)) return whenIdle();
    enqueue(fromFailure(failure), true);
    pump();
    return whenIdle();
  }

  /** Aborts the running request and clears the queue. What was saved stays saved; a late reply is ignored. */
  function cancel(): void {
    if (jobs.value.length === 0) return;
    controller?.abort();
    controller = null;
    jobs.value = [];
    progress.value = null;
    settleIdle();
  }

  // The jobs and failures belong to the project they were made in.
  watch(
    () => project.project?.id,
    (id, before) => {
      if (id === before) return;
      cancel();
      failures.value = new Map();
      lastFailed.value = null;
      stopped.value = null;
    },
  );

  onScopeDispose(() => {
    controller?.abort();
    unloadGuard.release();
  });

  return {
    current,
    queued,
    isBusy,
    failures,
    stopped,
    queueProgress,
    needsKey,
    summariseAllIds,
    statusOf,
    jobFor,
    failureFor,
    addCurrentTranscript,
    summarise,
    resume,
    cancel,
    whenIdle,
  };
});

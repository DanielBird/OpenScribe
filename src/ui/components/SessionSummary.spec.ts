import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionText } from '../../domain/corpus/sessionText';
import { NOT_DISCUSSED, type SessionSummaryFile } from '../../domain/summary';
import { ProviderError } from '../../providers/errors';
import { useNavStore } from '../../stores/nav';
import { usePipelineStore, type PipelineFailure } from '../../stores/pipeline';
import { useProjectStore, type FileSummaryStatus } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useSummaryEditStore } from '../../stores/summaryEdit';
import { useTranscriptStore } from '../../stores/transcript';
import { makeProjectSession, makeSessionText } from '../../testing/projectSessions';
import { makeSummaryReply } from '../../testing/summary';
import { makeDoc } from '../../testing/transcriptDoc';
import { placeCaret } from '../composables/useBlockNavigation';
import { useOpenTranscript } from '../composables/useOpenTranscript';
import ConfirmDialog from './ConfirmDialog.vue';
import QuoteCard from './QuoteCard.vue';
import SessionSummary from './SessionSummary.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

/** A German session with an English translation: "Anna" says two things. */
function sessionText(): SessionText {
  return makeSessionText(7, {
    languageCode: 'deu',
    turns: [
      {
        id: 't1',
        speakerId: 'speaker_0',
        start: 3,
        text: 'Wie laden Sie sie?',
        en: 'How do you charge them?',
      },
      {
        id: 't2',
        speakerId: 'speaker_1',
        start: 2472,
        text: 'Ich lege sie abends neben das Bett.',
        en: 'I put them on the charger by the bed, every night.',
      },
      {
        id: 't3',
        speakerId: 'speaker_1',
        start: 2500,
        text: 'Meine Tochter hilft.',
        en: 'My daughter helps me with it.',
      },
    ],
  });
}

function summaryFile(
  text: SessionText,
  overrides: Partial<SessionSummaryFile> = {},
): SessionSummaryFile {
  const reply = makeSummaryReply(text, {
    title: 'P07 – home visit, Hamburg',
    synopsis: 'Anna charges her aids every night.',
    overview: 'First paragraph.\n\nSecond paragraph.',
    respondents: [
      {
        speakerId: 'speaker_1',
        label: 'Anna',
        attributes: [
          { field: 'Age', value: '71', turnIds: ['t2'] },
          { field: 'Country', value: 'Germany', turnIds: [] },
        ],
      },
    ],
    researchQuestions: [
      {
        question: 'How do people charge?',
        finding: 'By the bed.',
        turnIds: ['t2'],
        quotes: [{ turnId: 't2', text: 'i put them on the charger by the bed' }],
      },
      { question: 'Who helps?', finding: NOT_DISCUSSED, turnIds: [], quotes: [] },
    ],
    themes: [
      {
        name: 'charging routines',
        description: 'Part of bedtime.',
        turnIds: ['t2'],
        isNew: false,
        quotes: [{ turnId: 't3', text: 'My daughter helps me' }],
      },
    ],
  });
  return {
    kind: 'describe.summary',
    schemaVersion: 1,
    sessionId: text.sessionId,
    createdAt: '2026-10-15T10:00:00.000Z',
    model: 'claude-sonnet-5-5',
    transcriptHash: text.transcriptHash,
    briefHash: 'brief',
    droppedQuotes: 2,
    summary: reply,
    ...overrides,
  };
}

describe('SessionSummary', () => {
  let wrapper: VueWrapper | null = null;
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function show(
    options: {
      status?: FileSummaryStatus;
      summary?: boolean;
      text?: SessionText;
      copies?: string[];
    } = {},
  ) {
    const text = options.text ?? sessionText();
    const project = useProjectStore();
    const withSummary = options.summary ?? true;
    project.sessions = [
      makeProjectSession(
        text,
        options.copies ?? [],
        withSummary ? { file: summaryFile(text), status: options.status ?? 'ok' } : null,
      ),
    ];
    project.corpus = [text];
    // With the confirmation that ProjectView shows for every Open.
    const { openDialog } = useOpenTranscript();
    const host = defineComponent({
      setup: () => () => [
        h(SessionSummary, { sessionId: text.sessionId }),
        h(ConfirmDialog, openDialog.value),
      ],
    });
    wrapper = mount(host, { attachTo: document.body });
    return { project, text };
  }

  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);

  it('takes focus when the session was picked in the list, and not otherwise', async () => {
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    const option = document.createElement('li');
    option.tabIndex = 0;
    list.append(option);
    document.body.append(list);
    option.focus();
    show();
    await flushPromises();
    expect(document.activeElement).toBe(wrapper!.get('h2').element);
    list.remove();

    wrapper!.unmount();
    (document.activeElement as HTMLElement | null)?.blur();
    show();
    await flushPromises();
    expect(document.activeElement).not.toBe(wrapper!.get('h2').element);
  });

  it('leaves a language that is not known out of the line under the name', async () => {
    show({ text: { ...sessionText(), languageCode: '' } });
    await flushPromises();
    expect(wrapper!.get('.meta').text()).toBe('7 Sept 2026 · 01:02:05 · Translated');

    wrapper!.unmount();
    const untranslated = sessionText();
    show({
      text: {
        ...untranslated,
        languageCode: '',
        turns: untranslated.turns.map((t) => ({ ...t, en: null })),
      },
    });
    await flushPromises();
    expect(wrapper!.get('.meta').text()).toBe('7 Sept 2026 · 01:02:05');
  });

  it('shows every section', async () => {
    show({ copies: ['P07--x.summary-LAPTOP.json'] });
    await flushPromises();
    const heading = wrapper!.get('h2');
    expect(heading.text()).toBe('P07 – home visit, Hamburg');
    expect(wrapper!.get('.meta').text()).toBe('7 Sept 2026 · 01:02:05 · German, translated');
    expect(wrapper!.get('.synopsis').text()).toBe('Anna charges her aids every night.');
    expect(wrapper!.findAll('h3').map((h) => h.text())).toEqual([
      'Overview',
      'Respondents',
      'Research questions',
      'Themes',
    ]);
    expect(
      wrapper!
        .findAll('.section')[0]!
        .findAll('p')
        .map((p) => p.text()),
    ).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(wrapper!.get('h4').text()).toBe('Anna');
    expect(wrapper!.findAll('.attributes dt').map((d) => d.text())).toEqual(['Age', 'Country']);
    expect(wrapper!.find('.questions .muted').text()).toBe(NOT_DISCUSSED);
    expect(wrapper!.get('.themes dt').text()).toBe('charging routines');
    const details = wrapper!.get('details').text();
    expect(details).toContain('Made with Sonnet 5.5 on 15 Oct 2026');
    expect(details).toContain(
      "2 quotes couldn't be verified against the transcript and were left out.",
    );
    expect(details).toContain('P07--x.summary-LAPTOP.json');
    expect(wrapper!.get('details').find('button').text()).toBe('Regenerate');
    // Up to date: no status notice.
    expect(wrapper!.find('.status').exists()).toBe(false);
  });

  it("shows each quote under its finding or theme, in the transcript's own words, with its citation", () => {
    show();
    const cards = wrapper!.findAllComponents(QuoteCard);
    expect(
      cards.map((c) => [c.element.closest('.questions li, .themes dd')?.tagName, c.props('text')]),
    ).toEqual([
      ['LI', 'I put them on the charger by the bed'],
      ['DD', 'My daughter helps me'],
    ]);
    expect(cards.map((c) => c.props('check'))).toEqual(['verified', 'verified']);
    expect(cards[0]!.props('text')).toBe('I put them on the charger by the bed');
    expect(cards[0]!.props('translatedFrom')).toBe('deu');
    expect(cards[0]!.props('citation')).toBe(
      '"I put them on the charger by the bed" — Anna, 00:41:12, P07 – home visit, Hamburg (translated from German)',
    );
    expect(cards.map((c) => c.props('at'))).toEqual([
      { sessionId: 'session-7', turnId: 't2' },
      { sessionId: 'session-7', turnId: 't3' },
    ]);
  });

  it("opens a quote's turn on Output, in English", async () => {
    show();
    const transcript = useTranscriptStore();
    const open = vi.spyOn(transcript, 'openFromProject').mockResolvedValue(undefined);
    const showTurn = vi.spyOn(transcript, 'showTurn');
    const goTo = vi.spyOn(useNavStore(), 'goTo').mockReturnValue(true);
    await wrapper!.find('button[aria-label^="Open in transcript: I put them"]').trigger('click');
    await flushPromises();
    expect(open).toHaveBeenCalledWith('session-7');
    expect(showTurn).toHaveBeenCalledWith('t2', true);
    expect(goTo).toHaveBeenCalledWith('output');
  });

  it('names a Gemini model in the details', async () => {
    const { project, text } = show();
    project.sessions = [
      makeProjectSession(text, [], {
        file: { ...summaryFile(text), model: 'gemini-4-argon', provider: 'gemini' },
        status: 'ok',
      }),
    ];
    await flushPromises();
    expect(wrapper!.get('details').text()).toContain('Made with Gemini 4 Argon on 15 Oct 2026');
  });

  it('marks a quote that no longer matches its turn', async () => {
    const text = sessionText();
    const edited = {
      ...text,
      turns: text.turns.map((t) => (t.id === 't3' ? { ...t, en: 'Nobody helps.' } : t)),
    };
    const project = useProjectStore();
    project.sessions = [
      makeProjectSession(edited, [], { file: summaryFile(text), status: 'stale' }),
    ];
    project.corpus = [edited];
    wrapper = mount(SessionSummary, { props: { sessionId: text.sessionId } });
    const cards = wrapper.findAllComponents(QuoteCard);
    expect(cards.map((c) => c.props('check'))).toEqual(['verified', 'not_found']);
    expect(cards[1]!.props('citation')).toBeNull();
    // Still in its turn, which can be read to see what changed.
    expect(cards[1]!.props('at')).toEqual({ sessionId: 'session-7', turnId: 't3' });
  });

  it('marks a saved quote whose left-out words could change it (D44)', () => {
    const text = sessionText();
    const file = summaryFile(text);
    const themes = file.summary.themes.map((t) => ({
      ...t,
      quotes: [{ turnId: 't2', text: 'I put … every night' }],
    }));
    const project = useProjectStore();
    project.sessions = [
      makeProjectSession(text, [], { file: { ...file, summary: { ...file.summary, themes } } }),
    ];
    project.corpus = [text];
    wrapper = mount(SessionSummary, { props: { sessionId: text.sessionId } });
    const cards = wrapper.findAllComponents(QuoteCard);
    expect(cards.map((c) => c.props('check'))).toEqual(['verified', 'unsafe_omission']);
    expect(cards[1]!.text()).toContain('Left-out words may change the meaning');
    expect(cards[1]!.props('citation')).toBeNull();
  });

  it('out of date: says so, with Regenerate', async () => {
    useSettingsStore().claudeKey = 'test-key';
    show({ status: 'stale' });
    const summarise = vi.spyOn(usePipelineStore(), 'summarise').mockResolvedValue(undefined);
    expect(wrapper!.get('.status').text()).toContain('Out of date');
    await wrapper!.get('.status button').trigger('click');
    expect(summarise).toHaveBeenCalledWith(['session-7']);
  });

  it('no summary: offers Summarise', async () => {
    useSettingsStore().claudeKey = 'test-key';
    show({ summary: false });
    const summarise = vi.spyOn(usePipelineStore(), 'summarise').mockResolvedValue(undefined);
    expect(wrapper!.get('.status').text()).toContain('No summary yet.');
    expect(wrapper!.findAll('h3')).toHaveLength(0);
    await button('Summarise')!.trigger('click');
    expect(summarise).toHaveBeenCalledWith(['session-7']);
  });

  it('failed: shows the error, with Try again', async () => {
    useSettingsStore().claudeKey = 'test-key';
    const pipeline = usePipelineStore();
    const failure: PipelineFailure = {
      sessionId: 'session-7',
      title: 'P07',
      kind: 'summarise',
      steps: ['summarise'],
      step: 'summarise',
      error: new ProviderError('server', 'Claude is busy. Try again.', {
        status: 500,
        detail: 'api_error: Internal server error',
      }),
      reconnect: false,
      partial: null,
    };
    vi.spyOn(pipeline, 'statusOf').mockReturnValue('failed');
    vi.spyOn(pipeline, 'failureFor').mockReturnValue(failure);
    const summarise = vi.spyOn(pipeline, 'summarise').mockResolvedValue(undefined);
    show({ summary: false });
    expect(wrapper!.get('[role="alert"]').text()).toBe('Claude is busy. Try again.');
    expect(wrapper!.get('.status-failed details pre').text()).toContain(
      'server · HTTP 500\napi_error: Internal server error',
    );
    await button('Try again')!.trigger('click');
    expect(summarise).toHaveBeenCalledWith(['session-7']);
  });

  it('running: shows the progress, and Open transcript waits', () => {
    const pipeline = usePipelineStore();
    vi.spyOn(pipeline, 'statusOf').mockReturnValue('running');
    vi.spyOn(pipeline, 'jobFor').mockReturnValue({
      sessionId: 'session-7',
      title: 'P07',
      kind: 'summarise',
      steps: ['translate', 'summarise'],
      current: 'translate',
      progress: { batch: 3, totalBatches: 12 },
      status: 'running',
    });
    show({ status: 'stale' });
    expect(wrapper!.get('.status-line').text()).toBe('Translating, batch 3 of 12');
    expect(button('Open transcript')!.attributes('disabled')).toBeDefined();
  });

  it('asks for the Claude key before summarising without one', async () => {
    show({ summary: false });
    const summarise = vi.spyOn(usePipelineStore(), 'summarise').mockResolvedValue(undefined);
    await button('Summarise')!.trigger('click');
    await flushPromises();
    expect(summarise).not.toHaveBeenCalled();
    const dialog = wrapper!.findAll('dialog').find((d) => (d.element as HTMLDialogElement).open)!;
    expect(dialog.get('h2').text()).toBe('Summarise');
    await dialog.get('input').setValue('test-key');
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Summarise')!
      .trigger('click');
    expect(summarise).toHaveBeenCalledWith(['session-7']);
  });

  it('says it translates first when a turn changed since the translation (D39)', async () => {
    const text = sessionText();
    const stale = {
      ...text,
      turns: text.turns.map((t) => (t.id === 't3' ? { ...t, en: null } : t)),
    };
    show({ summary: false, text: stale });
    await button('Summarise')!.trigger('click');
    await flushPromises();
    const dialog = wrapper!.findAll('dialog').find((d) => (d.element as HTMLDialogElement).open)!;
    expect(dialog.text()).toContain('to translate and summarise');
  });

  describe('Open transcript', () => {
    it('opens it on Output, linked', async () => {
      show();
      const transcript = useTranscriptStore();
      const open = vi.spyOn(transcript, 'openFromProject').mockResolvedValue(undefined);
      const goTo = vi.spyOn(useNavStore(), 'goTo').mockReturnValue(true);
      await button('Open transcript')!.trigger('click');
      await flushPromises();
      expect(open).toHaveBeenCalledWith('session-7');
      expect(goTo).toHaveBeenCalledWith('output');
    });

    it('asks first when it would replace a transcript that is in no project', async () => {
      show();
      const transcript = useTranscriptStore();
      await transcript.setDoc(makeDoc({ id: 'unlinked' }));
      const open = vi.spyOn(transcript, 'openFromProject').mockResolvedValue(undefined);
      await button('Open transcript')!.trigger('click');
      await flushPromises();
      const dialog = wrapper!.findAll('dialog').find((d) => (d.element as HTMLDialogElement).open)!;
      expect(dialog.text()).toContain("It isn't in a project, and is saved only in this browser.");
      await dialog
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
        .trigger('click');
      await flushPromises();
      expect(open).not.toHaveBeenCalled();

      await button('Open transcript')!.trigger('click');
      await flushPromises();
      await wrapper!
        .findAll('dialog')
        .find((d) => (d.element as HTMLDialogElement).open)!
        .findAll('button')
        .find((b) => b.text() === 'Replace')!
        .trigger('click');
      await flushPromises();
      expect(open).toHaveBeenCalledWith('session-7');
    });

    it("says so when the file can't be read", async () => {
      show();
      vi.spyOn(useTranscriptStore(), 'openFromProject').mockRejectedValue(
        Object.assign(new Error('offline'), { userMessage: 'This file is only in OneDrive.' }),
      );
      await button('Open transcript')!.trigger('click');
      await flushPromises();
      expect(wrapper!.get('.head [role="alert"]').text()).toBe('This file is only in OneDrive.');
    });
  });

  it('Sessions goes back (narrow windows)', async () => {
    show();
    await button('Sessions')!.trigger('click');
    expect(wrapper!.getComponent(SessionSummary).emitted('back')).toHaveLength(1);
  });

  describe('Edit (Phase 39)', () => {
    /** Shows the summary and turns Edit on, with saves to the folder resolved. */
    async function editing(options: Parameters<typeof show>[0] = {}) {
      const shown = show(options);
      vi.spyOn(shown.project, 'saveEditedSummary').mockResolvedValue({ size: 1, lastModified: 2 });
      await button('Edit')!.trigger('click');
      await flushPromises();
      return { ...shown, edit: useSummaryEditStore() };
    }

    const block = (name: string) => {
      const el = wrapper!.find(`[aria-label="${name}"]`);
      if (!el.exists()) throw new Error(`no block named ${name}`);
      return el;
    };
    const blockNames = () =>
      wrapper!.findAll('[role="textbox"]').map((b) => b.attributes('aria-label'));
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? null;

    /** Types into a block as the browser would: the text changes, then `input`. */
    async function type(name: string, text: string) {
      const el = block(name);
      (el.element as HTMLElement).focus();
      await el.trigger('focus');
      el.element.textContent = text;
      await el.trigger('input');
    }

    /** A key in a block, with the caret at `at`. */
    async function key(name: string, key: string, at: number | 'start' | 'end' = 'end') {
      const el = block(name).element as HTMLElement;
      el.focus();
      placeCaret(el, at);
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await flushPromises();
    }

    it('makes each piece of text an editable block where it stands, and Done ends it', async () => {
      await editing();
      expect(wrapper!.get('h2').attributes()).toMatchObject({
        contenteditable: 'plaintext-only',
        role: 'textbox',
        'aria-label': 'Title',
      });
      expect(blockNames()).toEqual([
        'Title',
        'Synopsis',
        'Overview, paragraph 1',
        'Overview, paragraph 2',
        'Respondent',
        'Detail of Anna',
        'Age of Anna',
        'Detail of Anna',
        'Country of Anna',
        'Finding: How do people charge?',
        'Finding: Who helps?',
        'Name of theme 1',
        'Description of charging routines',
      ]);
      expect(block('Overview, paragraph 1').attributes('aria-multiline')).toBe('true');
      expect(block('Synopsis').text()).toBe('Anna charges her aids every night.');
      expect(wrapper!.get('.head [aria-live="polite"]').text()).toBe('Editing');
      // A quote's words can't be edited, and the question's wording is the brief's.
      expect(wrapper!.find('.quote-card [contenteditable]').exists()).toBe(false);
      expect(wrapper!.get('.question').attributes('contenteditable')).toBeUndefined();

      await button('Done')!.trigger('click');
      await flushPromises();
      expect(wrapper!.find('[contenteditable]').exists()).toBe(false);
      expect(button('Edit')).toBeDefined();
      expect(wrapper!.get('.head [aria-live="polite"]').text()).toBe('Editing finished');
    });

    it('sends what is typed to the draft, and saves it', async () => {
      const { edit, project } = await editing();
      await type('Synopsis', 'She charges them by the bed.');
      expect(edit.draft!.synopsis).toBe('She charges them by the bed.');
      await type('Name of theme 1', 'Bedtime');
      expect(edit.draft!.themes[0]).toMatchObject({ name: 'Bedtime', isNew: true });
      await edit.flush();
      expect(project.saveEditedSummary).toHaveBeenCalled();
    });

    it('gives an emptied title back its text, and makes an emptied finding "not discussed"', async () => {
      const { edit } = await editing();
      await type('Title', '');
      await block('Title').trigger('blur');
      expect(edit.draft!.title).toBe('P07 – home visit, Hamburg');
      expect(block('Title').text()).toBe('P07 – home visit, Hamburg');
      await type('Finding: How do people charge?', '  ');
      await block('Finding: How do people charge?').trigger('blur');
      expect(edit.draft!.researchQuestions[0]!.finding).toBe(NOT_DISCUSSED);
    });

    it('Enter splits an overview paragraph, and Backspace at its start joins it again', async () => {
      const { edit } = await editing();
      await key('Overview, paragraph 1', 'Enter', 5);
      expect(edit.draft!.overview).toBe('First\n\nparagraph.\n\nSecond paragraph.');
      expect(block('Overview, paragraph 1').text()).toBe('First');
      expect(focused()).toBe('Overview, paragraph 2');
      await key('Overview, paragraph 2', 'Backspace', 'start');
      expect(edit.draft!.overview).toBe('First paragraph.\n\nSecond paragraph.');
      expect(blockNames().filter((n) => n?.startsWith('Overview'))).toHaveLength(2);
    });

    it('Enter at the end of a description adds a theme, and Backspace in it removes it', async () => {
      const { edit } = await editing();
      await key('Description of charging routines', 'Enter');
      expect(edit.draft!.themes).toHaveLength(2);
      expect(focused()).toBe('Name of theme 2');
      await key('Name of theme 2', 'Backspace', 'start');
      expect(edit.draft!.themes).toHaveLength(1);
      expect(focused()).toBe('Description of charging routines');
    });

    it('Enter at the end of a detail adds a row; elsewhere it goes on to the next block', async () => {
      const { edit } = await editing();
      await key('Age of Anna', 'Enter');
      expect(edit.draft!.respondents[0]!.attributes.map((a) => a.field)).toEqual([
        'Age',
        '',
        'Country',
      ]);
      expect(focused()).toBe('Detail of Anna');
      await key('Synopsis', 'Enter', 'start');
      expect(focused()).toBe('Overview, paragraph 1');
      expect(edit.draft!.synopsis).toBe('Anna charges her aids every night.');
    });

    it('the arrow keys cross from block to block, and Escape goes to Done', async () => {
      await editing();
      await key('Title', 'ArrowRight', 'end');
      expect(focused()).toBe('Synopsis');
      await key('Synopsis', 'ArrowLeft', 'start');
      expect(focused()).toBe('Title');
      await key('Title', 'ArrowLeft', 'end');
      expect(focused()).toBe('Title');
      await key('Synopsis', 'Escape');
      expect(document.activeElement).toBe(button('Done')!.element);
    });

    it('pastes plain text on one line', async () => {
      const { edit } = await editing();
      const el = block('Synopsis').element as HTMLElement;
      el.focus();
      placeCaret(el, 'end');
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' More\nlines.' } });
      el.dispatchEvent(paste);
      await flushPromises();
      expect(paste.defaultPrevented).toBe(true);
      expect(edit.draft!.synopsis).toBe('Anna charges her aids every night. More lines.');
    });

    it('removes a quote, and adds one from its words: found in its turn, or kept and marked', async () => {
      const { edit } = await editing();
      const card = wrapper!.findAllComponents(QuoteCard)[0]!;
      await card.get('button[aria-label^="Remove quote"]').trigger('click');
      await flushPromises();
      expect(edit.draft!.researchQuestions[0]!.quotes).toEqual([]);
      expect(edit.draft!.researchQuestions[0]!.turnIds).toEqual(['t2']);

      await button('Add quote')!.trigger('click');
      await flushPromises();
      expect(focused()).toBe('New quote');
      block('New quote').element.textContent = 'charger by the bed, every night';
      await block('New quote').trigger('blur');
      expect(edit.draft!.researchQuestions[0]!.quotes).toEqual([
        { turnId: 't2', text: 'charger by the bed, every night.' },
      ]);

      await button('Add quote')!.trigger('click');
      await flushPromises();
      block('New quote').element.textContent = 'words nobody said';
      await block('New quote').trigger('blur');
      await flushPromises();
      expect(edit.draft!.researchQuestions[0]!.quotes[1]).toEqual({
        turnId: '',
        text: 'words nobody said',
      });
      expect(wrapper!.text()).toContain('Not found in the transcript');
    });

    it('hides Add quote at 3 quotes, and Remove theme removes a theme', async () => {
      const { edit } = await editing();
      const draft = edit.draft!;
      const three = [1, 2, 3].map(() => ({ turnId: 't3', text: 'My daughter helps me' }));
      edit.change({ ...draft, themes: [{ ...draft.themes[0]!, quotes: three }] });
      await flushPromises();
      expect(wrapper!.findAll('.themes button').map((b) => b.text())).not.toContain('Add quote');
      // Remove theme is on the theme's name row.
      const remove = wrapper!.get(
        '.themes dt button[aria-label="Remove theme: charging routines"]',
      );
      await remove.trigger('click');
      await flushPromises();
      expect(edit.draft!.themes).toEqual([]);
      expect(button('Add theme')).toBeDefined();
    });

    it('hides Regenerate while editing, and Edit while the pipeline works on the session', async () => {
      await editing({ status: 'stale' });
      expect(button('Regenerate')).toBeUndefined();
      await button('Done')!.trigger('click');
      await flushPromises();
      expect(button('Regenerate')).toBeDefined();
      wrapper!.unmount();
      wrapper = null;
      vi.spyOn(usePipelineStore(), 'statusOf').mockReturnValue('running');
      show();
      expect(button('Edit')).toBeUndefined();
    });
  });
});

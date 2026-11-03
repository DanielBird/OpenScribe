import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { usePipelineStore } from '../../stores/pipeline';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { makeSummaryFile } from '../../testing/projectSeed';
import { makeProjectSession, makeSessionText } from '../../testing/projectSessions';
import { makeDoc, withTranslation } from '../../testing/transcriptDoc';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import SessionList from './SessionList.vue';

const summary = makeSummaryFile(withTranslation(makeDoc()));

describe('SessionList', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    resetProjectUi();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  function withSessions(...sessions: ReturnType<typeof makeProjectSession>[]) {
    const project = useProjectStore();
    project.sessions = sessions;
    project.corpus = sessions.map((s) => s.text);
    return project;
  }

  const plain = (...texts: ReturnType<typeof makeSessionText>[]) =>
    texts.map((t) => makeProjectSession(t));

  it('shows the number of sessions and, for each, the name, language, duration, date and status', () => {
    withSessions(
      ...plain(
        makeSessionText(14, { languageCode: 'deu', durationSec: 5530 }),
        makeSessionText(3, { durationSec: null }),
      ),
    );
    wrapper = mount(SessionList);
    expect(wrapper.get('h2').text()).toBe('Sessions 2');
    const items = wrapper.findAll('li.session');
    expect(items.map((li) => li.get('.name').text())).toEqual([
      'P14 interview.m4a',
      'P03 interview.m4a',
    ]);
    expect(items[0]!.get('.meta').text()).toBe('DE · 01:32:10 · 14 Sept 2026');
    expect(items[1]!.get('.meta').text()).toBe('EN · 3 Sept 2026');
    // The code is for the eye; screen readers get words.
    expect(items[0]!.get('.meta').attributes('aria-hidden')).toBe('true');
    expect(items[0]!.get('.visually-hidden').text()).toBe(
      'German, 01:32:10, 14 Sept 2026. No summary.',
    );
  });

  it("reads out each summary status, with no mark on screen, and shows a summary's title", () => {
    const text = (n: number) => makeSessionText(n);
    withSessions(
      makeProjectSession(text(5), [], { file: summary, status: 'ok' }),
      makeProjectSession(text(4), [], { file: summary, status: 'stale' }),
      makeProjectSession(text(3)),
    );
    wrapper = mount(SessionList);
    const items = wrapper.findAll('li.session');
    expect(items[0]!.get('.name').text()).toBe(summary.summary.title);
    expect(wrapper.find('.mark').exists()).toBe(false);
    expect(items.map((li) => li.get('.visually-hidden').text().split('. ')[1])).toEqual([
      'Summarised.',
      'Summary out of date.',
      'No summary.',
    ]);
  });

  it('selects a session by click, and by Enter or Space after the arrow keys move', async () => {
    withSessions(...plain(makeSessionText(3), makeSessionText(2), makeSessionText(1)));
    wrapper = mount(SessionList, { attachTo: document.body });
    const ui = useProjectUi();
    const list = wrapper.get('[role="listbox"]');
    const options = () => wrapper!.findAll('[role="option"]');
    // One Tab stop.
    expect(options().map((o) => o.attributes('tabindex'))).toEqual(['0', '-1', '-1']);

    await options()[1]!.trigger('click');
    expect(ui.selected).toBe('session-2');
    expect(options()[1]!.attributes('aria-selected')).toBe('true');
    expect(options().map((o) => o.attributes('tabindex'))).toEqual(['-1', '0', '-1']);

    await options()[1]!.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(options()[2]!.element);
    await options()[2]!.trigger('keydown', { key: 'Home' });
    await flushPromises();
    expect(document.activeElement).toBe(options()[0]!.element);
    await options()[0]!.trigger('keydown', { key: 'Enter' });
    expect(ui.selected).toBe('session-3');
    await options()[0]!.trigger('keydown', { key: 'End' });
    await flushPromises();
    await options()[2]!.trigger('keydown', { key: ' ' });
    expect(ui.selected).toBe('session-1');
    expect(list.attributes('aria-labelledby')).toBe(wrapper.get('h2').attributes('id'));
  });

  it('offers Summarise all for the sessions that need it, and asks first', async () => {
    const project = withSessions(
      makeProjectSession(makeSessionText(3, { durationSec: 3600 }), [], { file: summary }),
      makeProjectSession(makeSessionText(2, { durationSec: 5400 })),
      makeProjectSession(makeSessionText(1, { durationSec: 3600 }), [], {
        file: summary,
        status: 'stale',
      }),
    );
    useSettingsStore().claudeKey = 'test-key';
    const summarise = vi.spyOn(usePipelineStore(), 'summarise').mockResolvedValue(undefined);
    wrapper = mount(SessionList, { attachTo: document.body });
    await wrapper.get('.foot button').trigger('click');
    await flushPromises();
    expect(wrapper.get('.foot button').text()).toBe('Summarise all (2)');
    const dialog = wrapper.get('dialog');
    expect(dialog.text()).toContain('Summarise 2 sessions, about 3 hours, with Sonnet 5.5?');
    // The key is there: no key field.
    expect(dialog.find('input').exists()).toBe(false);
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Summarise')!
      .trigger('click');
    expect(summarise).toHaveBeenCalledWith(['session-2', 'session-1']);
    expect(project.sessions).toHaveLength(3);
  });

  it('asks for the Claude key when it is missing', async () => {
    withSessions(...plain(makeSessionText(1)));
    wrapper = mount(SessionList, { attachTo: document.body });
    await wrapper.get('.foot button').trigger('click');
    await flushPromises();
    const dialog = wrapper.get('dialog');
    expect(dialog.get('input').attributes('type')).toBe('password');
    expect(dialog.text()).toContain('The transcript text is sent to Anthropic to summarise.');
    const confirm = dialog.findAll('button').find((b) => b.text() === 'Summarise')!;
    expect(confirm.attributes('disabled')).toBeDefined();
  });

  it('shows the error that stopped the queue, with its technical details', async () => {
    withSessions(...plain(makeSessionText(1)));
    usePipelineStore().stopped = new ProviderError(
      'quota',
      'Your Claude account is out of credit.',
      {
        status: 400,
        detail: 'billing_error: Your credit balance is too low',
      },
    );
    wrapper = mount(SessionList);
    await flushPromises();
    expect(wrapper.get('.foot [role="alert"]').text()).toBe(
      'Your Claude account is out of credit.',
    );
    expect(wrapper.get('.foot details pre').text()).toContain(
      'quota · HTTP 400\nbilling_error: Your credit balance is too low',
    );
  });

  it('has no Summarise all when every summary is up to date', () => {
    const text = makeSessionText(1);
    withSessions(makeProjectSession(text, [], { file: summary }));
    wrapper = mount(SessionList);
    expect(wrapper.find('.foot').exists()).toBe(false);
  });

  it("leaves one session's progress to its summary pane, and shows the queue's", async () => {
    withSessions(...plain(makeSessionText(3), makeSessionText(2), makeSessionText(1)));
    const pipeline = usePipelineStore();
    const job = {
      sessionId: 'session-1',
      title: 'P01 interview.m4a',
      kind: 'summarise' as const,
      steps: ['summarise' as const],
      current: 'summarise' as const,
      progress: null,
      status: 'running' as const,
    };
    vi.spyOn(pipeline, 'current', 'get').mockReturnValue(job);
    wrapper = mount(SessionList);
    // One session: no status here, and no Summarise all while it runs.
    pipeline.queueProgress = { done: 0, total: 1 };
    await flushPromises();
    expect(wrapper.find('.foot').exists()).toBe(false);

    pipeline.queueProgress = { done: 1, total: 3 };
    await flushPromises();
    expect(wrapper.get('.foot .status-line').text()).toBe('Summarising 2 of 3');
  });

  it('says when there are no sessions yet', () => {
    wrapper = mount(SessionList);
    expect(wrapper.get('h2').text()).toBe('Sessions 0');
    expect(wrapper.text()).toContain('No sessions yet.');
    expect(wrapper.find('details').exists()).toBe(false);
  });

  it("lists files that couldn't be read and conflict copies under a details", async () => {
    const project = useProjectStore();
    const text = makeSessionText(1);
    project.sessions = [makeProjectSession(text, ['P01-copy.transcript-LAPTOP.json'])];
    project.corpus = [text];
    project.problems = [
      { file: 'a.transcript.json', message: 'This file was moved or deleted.' },
      { file: 'b.transcript.json', message: "This file isn't one DeScribe can read." },
    ];
    wrapper = mount(SessionList);
    const details = wrapper.get('details');
    expect(details.get('summary').text()).toBe("2 files couldn't be read · 1 conflict copy");
    expect(details.findAll('li').map((li) => li.text())).toEqual([
      'a.transcript.json: This file was moved or deleted.',
      "b.transcript.json: This file isn't one DeScribe can read.",
      `P01-copy.transcript-LAPTOP.json: an older copy of ${project.sessions[0]!.transcriptFile.name}, not shown.`,
    ]);
  });

  it('drops the selection when its session is gone', async () => {
    const project = withSessions(...plain(makeSessionText(1), makeSessionText(2)));
    const ui = useProjectUi();
    ui.selected = 'session-1';
    wrapper = mount(SessionList);
    project.sessions = [makeProjectSession(makeSessionText(2))];
    await flushPromises();
    expect(ui.selected).toBeNull();
  });
});

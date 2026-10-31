import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptDoc } from '../../domain/transcript';
import { useProjectStore, type ProjectStatus } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc } from '../../testing/transcriptDoc';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import AddToProjectDialog from './AddToProjectDialog.vue';
import ApiKeyField from './ApiKeyField.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  saveTranscriptLink: vi.fn(() => Promise.resolve(true)),
}));

const englishDoc = (): TranscriptDoc => {
  const doc = makeDoc();
  return { ...doc, result: { ...doc.result, languageCode: 'eng' } };
};

describe('AddToProjectDialog', () => {
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

  async function open(status: ProjectStatus, doc: TranscriptDoc = makeDoc()) {
    await useTranscriptStore().setDoc(doc);
    const project = useProjectStore();
    project.status = status;
    project.projectName = 'Hearing at home 2026';
    wrapper = mount(AddToProjectDialog, { props: { open: false }, attachTo: document.body });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return project;
  }

  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
  const add = () => button('Add')!;

  it('names the open project, and adds once the key is there', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open('ready');
    expect(wrapper!.get('h2').text()).toBe('Add to “Hearing at home 2026”');
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(false);
    expect(wrapper!.get('.data-notice').text()).toBe(
      'The transcript text is sent to Anthropic to translate and summarise.',
    );
    await add().trigger('click');
    expect(wrapper!.emitted('add')).toHaveLength(1);
  });

  it('says only summarise for an English transcript', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open('ready', englishDoc());
    expect(wrapper!.get('.data-notice').text()).toBe(
      'The transcript text is sent to Anthropic to summarise.',
    );
  });

  it('asks for the Claude key when it is missing', async () => {
    await open('ready');
    expect(wrapper!.findComponent(ApiKeyField).props('provider')).toBe('claude');
    expect(add().attributes('disabled')).toBeDefined();
    await wrapper!.get('input').setValue('test-key');
    expect(add().attributes('disabled')).toBeUndefined();
  });

  it('with a Gemini model, asks for the Gemini key and says the text goes to Google', async () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key';
    settings.projectModel = 'gemini-3.8-flash';
    await open('ready');
    const field = wrapper!.findComponent(ApiKeyField);
    expect(field.props()).toMatchObject({ provider: 'gemini', label: 'Gemini (Google) API key' });
    expect(wrapper!.get('.data-notice').text()).toBe(
      'The transcript text is sent to Google to translate and summarise.',
    );
    expect(add().attributes('disabled')).toBeDefined();
    await wrapper!.get('input').setValue('test-key-gemini');
    expect(settings.geminiKey).toBe('test-key-gemini');
    expect(add().attributes('disabled')).toBeUndefined();
  });

  it('shows the project model, grouped by provider, as the Analyse header does', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open('ready');
    const select = wrapper!.get<HTMLSelectElement>('select');
    expect(wrapper!.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Model');
    expect(select.element.value).toBe('claude-sonnet-5-5');
    expect(
      select
        .findAll('optgroup')
        .map((g) => [g.attributes('label'), g.findAll('option').map((o) => o.text())]),
    ).toEqual([
      ['Claude', ['Sonnet 5.5', 'Opus 5.5']],
      ['Gemini', ['Gemini 3.8 Flash', 'Gemini 4 Argon']],
    ]);
  });

  it('switching to a Gemini model asks for its key, names Google, and is saved', async () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key';
    await open('ready');
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(false);

    await wrapper!.get('select').setValue('gemini-4-argon');
    expect(settings.projectModel).toBe('gemini-4-argon');
    expect(JSON.parse(localStorage.getItem('describe.v1.prefs') ?? '{}')).toMatchObject({
      projectModel: 'gemini-4-argon',
    });
    expect(wrapper!.findComponent(ApiKeyField).props()).toMatchObject({
      provider: 'gemini',
      label: 'Gemini (Google) API key',
    });
    expect(wrapper!.get('.data-notice').text()).toBe(
      'The transcript text is sent to Google to translate and summarise.',
    );
    expect(add().attributes('disabled')).toBeDefined();
    await wrapper!.get('input').setValue('test-key-gemini');
    expect(add().attributes('disabled')).toBeUndefined();
    // The field stays while the key is typed.
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(true);

    // Back to Claude, whose key is there: Add stays possible.
    await wrapper!.get('select').setValue('claude-opus-5-5');
    expect(wrapper!.get('.data-notice').text()).toContain('sent to Anthropic');
    expect(add().attributes('disabled')).toBeUndefined();
  });

  it('switching to a Gemini model whose key is there asks for nothing', async () => {
    const settings = useSettingsStore();
    settings.claudeKey = 'test-key';
    settings.geminiKey = 'test-key-gemini';
    await open('ready');
    await wrapper!.get('select').setValue('gemini-3.8-flash');
    expect(wrapper!.findComponent(ApiKeyField).exists()).toBe(false);
    expect(add().attributes('disabled')).toBeUndefined();
  });

  it('with no project: Open project… or New project…, and a new one opens the Brief', async () => {
    useSettingsStore().claudeKey = 'test-key';
    const project = await open('none');
    expect(wrapper!.get('h2').text()).toBe('Add to project');
    expect(add().attributes('disabled')).toBeDefined();
    const openProject = vi.spyOn(project, 'openProject').mockResolvedValue(false);
    const newProject = vi.spyOn(project, 'newProject').mockResolvedValue({ created: true });
    await button('Open project…')!.trigger('click');
    expect(openProject).toHaveBeenCalled();
    await button('New project…')!.trigger('click');
    await flushPromises();
    expect(newProject).toHaveBeenCalled();
    expect(useProjectUi().briefOpen).toBe(true);
  });

  it('offers Reconnect for the remembered project', async () => {
    const project = await open('reconnect');
    const reconnect = vi.spyOn(project, 'reconnect').mockResolvedValue(true);
    await button('Reconnect “Hearing at home 2026”')!.trigger('click');
    expect(reconnect).toHaveBeenCalled();
    expect(button('Open another project…')).toBeDefined();

    const newProject = vi.spyOn(project, 'newProject').mockResolvedValue({ created: true });
    await button('New project…')!.trigger('click');
    await flushPromises();
    expect(newProject).toHaveBeenCalled();
    expect(useProjectUi().briefOpen).toBe(true);
  });

  it('shows the progress while the project opens, and an error with Try again', async () => {
    const project = await open('loading');
    project.progress = { done: 3, total: 10 };
    await flushPromises();
    expect(wrapper!.text()).toContain('Reading 3 of 10 sessions');
    expect(wrapper!.get('progress').attributes('value')).toBe('3');

    project.status = 'error';
    project.error = "DeScribe can't read this project's describe-project.json.";
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toBe(project.error);
    expect(button('Try again')).toBeDefined();
    expect(button('Open another project…')).toBeDefined();
    expect(button('New project…')).toBeDefined();
  });

  it('closes itself when the transcript turns out to be in the project already', async () => {
    await open('ready');
    useTranscriptStore().projectLink = {
      docId: makeDoc().id,
      projectId: 'p',
      projectName: 'Hearing at home 2026',
      fileName: 'x.transcript.json',
      stat: { size: 1, lastModified: 1 },
    };
    await flushPromises();
    expect(wrapper!.emitted('cancel')).toHaveLength(1);
  });
});

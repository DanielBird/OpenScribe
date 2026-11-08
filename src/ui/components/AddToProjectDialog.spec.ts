import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FILE } from '../../domain/sessionFiles';
import type { TranscriptDoc } from '../../domain/transcript';
import { setLlmProviderFactoryForTests } from '../../providers/index';
import type { LlmProvider } from '../../providers/llm/types';
import { useChatStore } from '../../stores/chat';
import { usePipelineStore } from '../../stores/pipeline';
import { PROJECT_MESSAGES, useProjectStore, type ProjectStatus } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import {
  folderMocks,
  recentEntry,
  rememberFolder,
  resetFolderMocks,
} from '../../testing/folderMocks';
import { memoryFolder } from '../../testing/memoryFolder';
import { projectFiles } from '../../testing/projectSeed';
import { makeDoc } from '../../testing/transcriptDoc';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import AddToProjectDialog from './AddToProjectDialog.vue';
import ApiKeyField from './ApiKeyField.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  saveTranscriptLink: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../storage/folder', async (importOriginal) =>
  (await import('../../testing/folderMocks')).mockFolderModule(await importOriginal()),
);

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
    resetFolderMocks();
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

  it('shows the project model, as the Analyse header does', async () => {
    useSettingsStore().claudeKey = 'test-key';
    await open('ready');
    const select = wrapper!.get<HTMLSelectElement>('select');
    expect(wrapper!.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Model');
    expect(select.element.value).toBe('claude-sonnet-5-5');
    // The chat's settings are in the Analyse header only (D48).
    expect(wrapper!.find('[popover]').exists()).toBe(false);
    expect(select.find('optgroup').exists()).toBe(false);
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Sonnet 5.5',
      'Opus 5.5',
      'Gemini 3.8 Flash',
      'Gemini 4 Argon',
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

  describe('choosing the project (D49)', () => {
    const A = { id: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'Prosthetics' };
    const B = { id: 'bbbbbbbb-0000-4000-8000-000000000000', name: 'Hearing at home 2026' };

    /** `Prosthetics` open and, unless `only`, `Hearing at home 2026` in the recent list too. */
    async function connect(
      opts: { inA?: TranscriptDoc[]; inB?: TranscriptDoc[]; only?: boolean } = {},
    ) {
      const a = memoryFolder('A', projectFiles(opts.inA ?? [], A));
      const b = memoryFolder('B', projectFiles(opts.inB ?? [], B));
      folderMocks.recent = opts.only
        ? [recentEntry(a, A.id, A.name)]
        : [recentEntry(a, A.id, A.name), recentEntry(b, B.id, B.name)];
      rememberFolder(a, 'granted', A.name);
      const project = useProjectStore();
      await project.init();
      useSettingsStore().claudeKey = 'test-key';
      return { project, a, b };
    }

    async function show(doc: TranscriptDoc = makeDoc()) {
      await useTranscriptStore().setDoc(doc);
      wrapper = mount(AddToProjectDialog, { props: { open: false }, attachTo: document.body });
      await wrapper.setProps({ open: true });
      await flushPromises();
    }

    const projectSelect = () => wrapper!.find<HTMLSelectElement>('select[id$="-project"]');

    afterEach(() => {
      usePipelineStore().cancel();
      setLlmProviderFactoryForTests(null);
    });

    it('with one project known: names it, and offers another without a dropdown', async () => {
      const { project } = await connect({ only: true });
      await show();
      expect(wrapper!.get('h2').text()).toBe('Add to “Prosthetics”');
      expect(projectSelect().exists()).toBe(false);
      const openProject = vi.spyOn(project, 'openProject').mockResolvedValue(false);
      await button('Open another project…')!.trigger('click');
      expect(openProject).toHaveBeenCalled();
      expect(button('New project…')).toBeDefined();
    });

    it('with two known: a labelled dropdown, most recent first, on the open project', async () => {
      await connect();
      await show();
      expect(wrapper!.get('h2').text()).toBe('Add to project');
      const select = projectSelect();
      expect(wrapper!.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Project');
      expect(select.findAll('option').map((o) => o.text())).toEqual([A.name, B.name]);
      expect(select.element.value).toBe(A.id);
      expect(add().attributes('disabled')).toBeUndefined();
    });

    it('adds to the open project without opening anything', async () => {
      const { project } = await connect();
      await show();
      await add().trigger('click');
      await flushPromises();
      expect(wrapper!.emitted('add')).toHaveLength(1);
      expect(folderMocks.requests).toBe(0);
      expect(project.project?.id).toBe(A.id);
    });

    it('changes nothing when another project is chosen, then Cancel', async () => {
      const { project } = await connect();
      await show();
      await projectSelect().setValue(B.id);
      await button('Cancel')!.trigger('click');
      await flushPromises();
      expect(wrapper!.emitted('cancel')).toHaveLength(1);
      expect(folderMocks.requests).toBe(0);
      expect(project.project?.id).toBe(A.id);
      expect(project.recentProjects.map((p) => p.id)).toEqual([A.id, B.id]);
    });

    it('opens the chosen project on Add, then adds', async () => {
      const { project, b } = await connect();
      await show();
      await projectSelect().setValue(B.id);
      expect(project.project?.id).toBe(A.id);

      const release = b.hold();
      await add().trigger('click');
      await flushPromises();
      expect(folderMocks.requests).toBe(1);
      expect(add().attributes('disabled')).toBeDefined();
      expect(projectSelect().attributes('disabled')).toBeDefined();
      expect(wrapper!.emitted('add')).toBeUndefined();

      release();
      await flushPromises();
      expect(project.project?.id).toBe(B.id);
      expect(wrapper!.emitted('add')).toHaveLength(1);
      expect(wrapper!.get('[role="status"]').text()).toBe(`${B.name} is open.`);
      expect(projectSelect().element.value).toBe(B.id);
    });

    it('does not add if the dialog was cancelled while the project opened', async () => {
      const { b } = await connect();
      await show();
      await projectSelect().setValue(B.id);
      const release = b.hold();
      await add().trigger('click');
      await flushPromises();
      await wrapper!.setProps({ open: false });
      release();
      await flushPromises();
      expect(wrapper!.emitted('add')).toBeUndefined();
    });

    it('keeps the dialog and the open project when access is refused', async () => {
      const { project } = await connect();
      folderMocks.grantOnRequest = false;
      await show();
      await projectSelect().setValue(B.id);
      await add().trigger('click');
      await flushPromises();
      expect(wrapper!.get('[role="alert"]').text()).toBe(PROJECT_MESSAGES.accessRefused);
      expect(wrapper!.emitted('add')).toBeUndefined();
      expect(project.project?.id).toBe(A.id);
      expect(document.activeElement).toBe(projectSelect().element);
      expect(add().attributes('disabled')).toBeUndefined();

      // A new choice clears the message.
      await projectSelect().setValue(A.id);
      expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    });

    it('drops a folder that is gone, says so, and stays on the open project', async () => {
      const { project, b } = await connect();
      b.remove(PROJECT_FILE);
      await show();
      await projectSelect().setValue(B.id);
      await add().trigger('click');
      await flushPromises();
      expect(wrapper!.get('[role="alert"]').text()).toBe(PROJECT_MESSAGES.projectGone(B.name));
      expect(project.project?.id).toBe(A.id);
      expect(wrapper!.emitted('add')).toBeUndefined();
      // One project left: its name is back in the title, and Add adds to it.
      expect(projectSelect().exists()).toBe(false);
      expect(wrapper!.get('h2').text()).toBe('Add to “Prosthetics”');
      await add().trigger('click');
      await flushPromises();
      expect(wrapper!.emitted('add')).toHaveLength(1);
    });

    it('adds nothing if the transcript is in the chosen project already', async () => {
      const doc = englishDoc();
      const { project } = await connect({ inB: [doc] });
      await show(doc);
      await projectSelect().setValue(B.id);
      await add().trigger('click');
      await flushPromises();
      expect(project.project?.id).toBe(B.id);
      expect(wrapper!.emitted('add')).toBeUndefined();
      expect(wrapper!.emitted('cancel')).toHaveLength(1);
    });

    it('offers the project again from a reconnect, where Add does the asking', async () => {
      const a = memoryFolder('A', projectFiles([], A));
      const b = memoryFolder('B', projectFiles([], B));
      folderMocks.recent = [recentEntry(a, A.id, A.name), recentEntry(b, B.id, B.name)];
      rememberFolder(a, 'prompt', A.name);
      const project = useProjectStore();
      await project.init();
      useSettingsStore().claudeKey = 'test-key';
      await show();
      expect(project.status).toBe('reconnect');
      expect(button('Reconnect “Prosthetics”')).toBeDefined();
      expect(add().attributes('disabled')).toBeDefined();

      await projectSelect().setValue(B.id);
      expect(button('Reconnect “Prosthetics”')).toBeUndefined();
      expect(add().attributes('disabled')).toBeUndefined();
      await add().trigger('click');
      await flushPromises();
      expect(project.project?.id).toBe(B.id);
      expect(wrapper!.emitted('add')).toHaveLength(1);
    });

    it('is locked while a chat is answering, and says why', async () => {
      const { project } = await connect();
      await show();
      await projectSelect().setValue(B.id);
      useChatStore().messages = [
        { id: 'm', role: 'assistant', status: 'streaming' },
      ] as unknown as ReturnType<typeof useChatStore>['messages'];
      await flushPromises();
      expect(projectSelect().attributes('disabled')).toBeDefined();
      expect(button('Open another project…')!.attributes('disabled')).toBeDefined();
      expect(button('New project…')!.attributes('disabled')).toBeDefined();
      expect(wrapper!.text()).toContain('You can choose another project once');
      // Adding here would cancel the answer.
      expect(add().attributes('disabled')).toBeDefined();
      expect(project.project?.id).toBe(A.id);
    });

    it('is locked while the pipeline works, and can still add to the open project', async () => {
      setLlmProviderFactoryForTests((id, _key, model): LlmProvider => ({
        id,
        model,
        generateStructured: () => new Promise(() => undefined),
      }));
      const session = { ...englishDoc(), id: 'cccccccc-0000-4000-8000-000000000000' };
      await connect({ inA: [session] });
      await show();
      void usePipelineStore().summarise([session.id]);
      await flushPromises();
      expect(projectSelect().attributes('disabled')).toBeDefined();
      expect(wrapper!.text()).toContain('You can choose another project once');
      expect(add().attributes('disabled')).toBeUndefined();
    });

    it('has no choice for a transcript already in a project', async () => {
      const doc = englishDoc();
      await connect({ inA: [doc] });
      await show(doc);
      expect(useTranscriptStore().projectLink?.projectId).toBe(A.id);
      expect(wrapper!.get('h2').text()).toBe('Add to “Prosthetics”');
      expect(projectSelect().exists()).toBe(false);
      expect(button('Open another project…')).toBeUndefined();
    });

    it('has no choice for a transcript whose job failed', async () => {
      await connect();
      useSettingsStore().claudeKey = '';
      await useTranscriptStore().setDoc(makeDoc());
      await usePipelineStore().addCurrentTranscript();
      await show();
      expect(wrapper!.get('h2').text()).toBe('Add to “Prosthetics”');
      expect(projectSelect().exists()).toBe(false);
      expect(button('New project…')).toBeUndefined();
    });
  });
});

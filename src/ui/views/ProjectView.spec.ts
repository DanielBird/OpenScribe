import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_MESSAGES, useProjectStore } from '../../stores/project';
import { makeChatFile, makeProjectFile } from '../../testing/projectSeed';
import { makeProjectSession, makeSessionText } from '../../testing/projectSessions';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import ProjectView from './ProjectView.vue';

describe('ProjectView', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    resetProjectUi();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const buttons = () => wrapper!.findAll('.view > div button').map((b) => b.text());
  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name)!;

  function mountIn(status: ReturnType<typeof useProjectStore>['status']) {
    const project = useProjectStore();
    project.status = status;
    wrapper = mount(ProjectView, { attachTo: document.body });
    return project;
  }

  function readyProject() {
    const project = useProjectStore();
    const texts = [makeSessionText(2), makeSessionText(1)];
    project.project = makeProjectFile();
    project.projectName = 'Hearing at home 2026';
    project.projectStat = { size: 1, lastModified: 1 };
    project.sessions = texts.map((t) => makeProjectSession(t));
    project.corpus = texts;
    return project;
  }

  it('has the hidden h1 that takes focus on a mode change', () => {
    mountIn('none');
    const h1 = wrapper!.get('h1');
    expect(h1.text()).toBe('Analyse');
    expect(h1.classes()).toContain('visually-hidden');
    expect(h1.attributes('tabindex')).toBe('-1');
  });

  it('unsupported: says which browsers can open projects', () => {
    mountIn('unsupported');
    expect(wrapper!.text()).toContain(
      "This browser can't open project folders. Use Edge or Chrome.",
    );
    expect(wrapper!.find('.view > div button').exists()).toBe(false);
  });

  it('none: offers Open project and New project, with one line', () => {
    mountIn('none');
    expect(buttons()).toEqual(['Open project…', 'New project…']);
    expect(wrapper!.text()).toContain('A project is a shared folder, for example in OneDrive.');
  });

  it('none: Open project opens; a refused folder shows the notice', async () => {
    const project = mountIn('none');
    const open = vi.spyOn(project, 'openProject').mockImplementation(async () => {
      project.notice = PROJECT_MESSAGES.notAProject;
      return false;
    });
    await button('Open project…').trigger('click');
    await flushPromises();
    expect(open).toHaveBeenCalled();
    expect(wrapper!.get('[role="alert"]').text()).toBe(PROJECT_MESSAGES.notAProject);
  });

  it('opens the Brief dialog after New project creates one, not when it opens one', async () => {
    const project = mountIn('none');
    const ui = useProjectUi();
    const create = vi.spyOn(project, 'newProject');
    create.mockResolvedValueOnce({ created: false });
    await button('New project…').trigger('click');
    await flushPromises();
    expect(ui.briefOpen).toBe(false);

    create.mockResolvedValueOnce({ created: true });
    await button('New project…').trigger('click');
    await flushPromises();
    expect(ui.briefOpen).toBe(true);
  });

  it('reconnect: one Reconnect button with the name, Open another project and New project', async () => {
    const project = mountIn('reconnect');
    project.projectName = 'Hearing at home 2026';
    await flushPromises();
    expect(buttons()).toEqual([
      'Reconnect “Hearing at home 2026”',
      'Open another project…',
      'New project…',
    ]);
    const reconnect = vi.spyOn(project, 'reconnect').mockResolvedValue(true);
    await button('Reconnect “Hearing at home 2026”').trigger('click');
    expect(reconnect).toHaveBeenCalled();
  });

  // "This folder isn't a DeScribe project" says to use New project, so every state that can show it offers it.
  it('reconnect: New project creates one there and opens the Brief', async () => {
    const project = mountIn('reconnect');
    const create = vi.spyOn(project, 'newProject').mockResolvedValue({ created: true });
    await button('New project…').trigger('click');
    await flushPromises();
    expect(create).toHaveBeenCalled();
    expect(useProjectUi().briefOpen).toBe(true);
  });

  it('loading: says how far it got, with a progress bar', async () => {
    const project = mountIn('loading');
    expect(wrapper!.text()).toContain('Opening the project…');
    project.progress = { done: 12, total: 40 };
    await flushPromises();
    expect(wrapper!.get('#project-loading').text()).toBe('Reading 12 of 40 sessions');
    const bar = wrapper!.get<HTMLProgressElement>('progress');
    expect(bar.attributes('value')).toBe('12');
    expect(bar.attributes('max')).toBe('40');
    expect(bar.attributes('aria-labelledby')).toBe('project-loading');
  });

  it('error: the message, Try again, Open another project and New project', async () => {
    const project = mountIn('error');
    project.error = PROJECT_MESSAGES.projectFileInvalid;
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toBe(PROJECT_MESSAGES.projectFileInvalid);
    expect(buttons()).toEqual(['Try again', 'Open another project…', 'New project…']);
    const retry = vi.spyOn(project, 'retry').mockResolvedValue();
    await button('Try again').trigger('click');
    expect(retry).toHaveBeenCalled();
  });

  it('ready: the sessions list, with the chat on the right and the search in it', () => {
    readyProject();
    mountIn('ready');
    expect(wrapper!.find('.sessions-pane input[type="search"]').exists()).toBe(false);
    expect(wrapper!.find('.detail-pane input[type="search"]').exists()).toBe(true);
    expect(wrapper!.findAll('.detail-pane .modes button').map((b) => b.text())).toEqual([
      'Chat',
      'Search',
    ]);
    expect(wrapper!.get('.session-list h2').text()).toBe('Sessions 2');
    expect(wrapper!.get('.detail-pane .chat-pane').isVisible()).toBe(true);
    expect(wrapper!.find('.session-summary').exists()).toBe(false);
  });

  it('ready: Sessions and Chats are two tabs with their counts, by click and by the arrow keys', async () => {
    const project = readyProject();
    project.chats = [
      {
        file: makeChatFile(),
        name: 'chat.chat.json',
        stat: { size: 1, lastModified: 1 },
      },
    ];
    project.chatsLoaded = true;
    mountIn('ready');
    const tabs = () => wrapper!.findAll('[role="tab"]');
    const panel = (id: string) => wrapper!.get(`#sidebar-panel-${id}`);
    expect(tabs().map((t) => t.text())).toEqual(['Sessions 2', 'Chats 1']);
    expect(tabs().map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs().map((t) => t.attributes('tabindex'))).toEqual(['0', '-1']);
    expect(panel('sessions').attributes('aria-labelledby')).toBe(tabs()[0]!.attributes('id'));
    expect(panel('sessions').isVisible()).toBe(true);
    expect(panel('chats').isVisible()).toBe(false);

    await tabs()[1]!.trigger('click');
    expect(panel('chats').isVisible()).toBe(true);
    expect(panel('sessions').isVisible()).toBe(false);
    expect(panel('chats').text()).toContain(makeChatFile().title);

    await tabs()[1]!.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(useProjectUi().sidebarTab).toBe('sessions');
    expect(document.activeElement).toBe(tabs()[0]!.element);
    await tabs()[0]!.trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(useProjectUi().sidebarTab).toBe('chats');
  });

  it('a selected session shows its summary in place of the chat; Escape returns', async () => {
    const project = readyProject();
    mountIn('ready');
    const ui = useProjectUi();
    ui.selected = project.sessions[0]!.sessionId;
    await flushPromises();
    expect(wrapper!.find('.session-summary').exists()).toBe(true);
    expect(wrapper!.get('.chat-pane').isVisible()).toBe(false);

    await wrapper!.get('.session-summary h2').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(ui.selected).toBeNull();
    expect(wrapper!.get('.chat-pane').isVisible()).toBe(true);
    expect(document.activeElement).toBe(wrapper!.get('.chat-pane textarea').element);
  });

  it('Escape in a summary returns to the chat, but not from a field inside it', async () => {
    const project = readyProject();
    mountIn('ready');
    const ui = useProjectUi();
    ui.selected = project.sessions[0]!.sessionId;
    await flushPromises();

    const input = document.createElement('input');
    wrapper!.get('.session-summary').element.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(ui.selected).not.toBeNull();

    await wrapper!.get('.session-summary h2').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(ui.selected).toBeNull();
  });

  it('ready: announces the open project to screen readers', () => {
    readyProject();
    mountIn('ready');
    expect(wrapper!.get('p[role="status"]').text()).toBe(
      'Hearing at home 2026 is open: 2 sessions.',
    );
  });

  it('ready: rescans when shown, since entering the mode fires no focus event', () => {
    const project = readyProject();
    const refresh = vi.spyOn(project, 'scheduleRefresh');
    mountIn('ready');
    expect(refresh).toHaveBeenCalled();
  });

  it('Change shows the chooser with Cancel, and Cancel goes back to the project', async () => {
    readyProject();
    mountIn('ready');
    const ui = useProjectUi();
    ui.choosing = true;
    await flushPromises();
    expect(buttons()).toEqual(['Open project…', 'New project…', 'Cancel']);
    expect(document.activeElement?.textContent).toBe('Open project…');
    expect(wrapper!.find('.session-list').exists()).toBe(false);

    await button('Cancel').trigger('click');
    await flushPromises();
    expect(ui.choosing).toBe(false);
    expect(wrapper!.find('.session-list').exists()).toBe(true);
  });

  it('the chooser closes once another project opens', async () => {
    const project = readyProject();
    mountIn('ready');
    const ui = useProjectUi();
    ui.choosing = true;
    await flushPromises();
    vi.spyOn(project, 'openProject').mockResolvedValue(true);
    await button('Open project…').trigger('click');
    await flushPromises();
    expect(ui.choosing).toBe(false);
  });
});

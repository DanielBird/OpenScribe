import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_MESSAGES, useProjectStore } from '../../stores/project';
import { makeProjectFile, TEST_BRIEF } from '../../testing/projectSeed';
import BriefDialog from './BriefDialog.vue';

const STAT = { size: 300, lastModified: 1000 };

describe('BriefDialog', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function openWith(project = makeProjectFile({ brief: TEST_BRIEF })) {
    const store = useProjectStore();
    store.project = project;
    store.projectStat = STAT;
    wrapper = mount(BriefDialog, { props: { open: true }, attachTo: document.body });
    return store;
  }

  const field = (label: string) => {
    const id = wrapper!
      .findAll('label')
      .find((l) => l.text() === label)!
      .attributes('for');
    return wrapper!.get<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  };
  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);

  it('opens with the project name and brief, one item per line, and focus on the name', async () => {
    openWith();
    await flushPromises();
    expect(wrapper!.get<HTMLDialogElement>('dialog').element.open).toBe(true);
    expect(wrapper!.get('dialog').attributes('aria-label')).toBe('Brief');
    expect(field('Project Name').element.value).toBe('Hearing at home 2026');
    expect(field('Key research questions').element.value).toBe(
      'How do people fit charging into their day?\nWho helps them?',
    );
    expect(field('Context').element.value).toBe('Home visits with hearing-aid users.');
    expect(field('Respondent details').element.value).toBe('Age\nCountry');
    expect(document.activeElement).toBe(field('Project Name').element);
    expect(field('Key research questions').attributes('aria-describedby')).toBeTruthy();
  });

  it('shows one section at a time: a tab opens its editor, and the arrow keys stay on the tabs', async () => {
    openWith();
    await flushPromises();
    const tab = (name: string) =>
      wrapper!.findAll('[role="tab"]').find((t) => t.text().startsWith(name))!;
    const panelOf = (label: string) =>
      field(label).element.closest<HTMLElement>('[role="tabpanel"]')!;
    expect(tab('Research questions').text()).toBe('Research questions');
    expect(panelOf('Key research questions').style.display).toBe('none');

    await tab('Research questions').trigger('click');
    await flushPromises();
    expect(panelOf('Key research questions').style.display).toBe('');
    expect(panelOf('Context').style.display).toBe('none');
    expect(document.activeElement).toBe(field('Key research questions').element);

    await tab('Research questions').trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(tab('Respondent details').attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Respondent details').element);
  });

  it('saves what was typed, against the stat when it opened, and closes', async () => {
    const store = openWith();
    const save = vi.spyOn(store, 'saveBrief').mockResolvedValue({ ok: true });
    await field('Project Name').setValue('Hearing 2027');
    await field('Key research questions').setValue('One?\n\nTwo?');
    await field('Respondent details').setValue('Age');
    store.projectStat = { size: 1, lastModified: 2 }; // a refresh read a newer file meanwhile
    await button('Save')!.trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledWith(
      'Hearing 2027',
      {
        researchQuestions: ['One?', '', 'Two?'],
        context: 'Home visits with hearing-aid users.',
        metadataFields: ['Age'],
      },
      STAT,
    );
    expect(wrapper!.emitted('close')).toHaveLength(1);
  });

  it("can't save without a name", async () => {
    openWith();
    await field('Project Name').setValue('   ');
    expect(button('Save')!.attributes('disabled')).toBeDefined();
  });

  it('offers Reload when someone else changed the brief, and loads their version', async () => {
    const store = openWith();
    vi.spyOn(store, 'saveBrief').mockResolvedValue({
      ok: false,
      reason: 'changed',
      message: PROJECT_MESSAGES.briefChanged,
    });
    const newStat = { size: 400, lastModified: 2000 };
    const reload = vi.spyOn(store, 'reloadProject').mockImplementation(async () => {
      store.project = makeProjectFile({
        name: 'Theirs',
        brief: { ...TEST_BRIEF, context: 'Their context' },
      });
      store.projectStat = newStat;
      return newStat;
    });
    await field('Context').setValue('Mine');
    await button('Save')!.trigger('click');
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toBe(PROJECT_MESSAGES.briefChanged);
    expect(button('Save')!.attributes('disabled')).toBeDefined();
    expect(wrapper!.emitted('close')).toBeUndefined();

    await button('Reload')!.trigger('click');
    await flushPromises();
    expect(reload).toHaveBeenCalled();
    expect(field('Project Name').element.value).toBe('Theirs');
    expect(field('Context').element.value).toBe('Their context');
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(button('Reload')).toBeUndefined();
    expect(button('Save')!.attributes('disabled')).toBeUndefined();
  });

  it('shows why a save failed, and stays open', async () => {
    const store = openWith();
    vi.spyOn(store, 'saveBrief').mockResolvedValue({
      ok: false,
      reason: 'failed',
      message: 'DeScribe no longer has access to the project folder. Reconnect it.',
    });
    await button('Save')!.trigger('click');
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toMatch(/no longer has access/);
    expect(button('Reload')).toBeUndefined();
    expect(wrapper!.emitted('close')).toBeUndefined();
  });

  it('closes on Cancel and on Escape, without saving', async () => {
    const store = openWith();
    const save = vi.spyOn(store, 'saveBrief');
    await button('Cancel')!.trigger('click');
    wrapper!.get('dialog').element.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(wrapper!.emitted('close')).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
  });
});

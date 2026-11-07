import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/settings';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import ProjectHeader from './ProjectHeader.vue';

describe('ProjectHeader', () => {
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

  it('has Brief, a labelled Model select and Change', () => {
    wrapper = mount(ProjectHeader);
    expect(wrapper.findAll('button').map((b) => b.attributes('aria-label') ?? b.text())).toEqual([
      'Brief',
      'Change',
      'Chat settings',
    ]);
    const select = wrapper.get('select');
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Model');
    expect(select.find('optgroup').exists()).toBe(false);
    expect(select.findAll('option').map((o) => o.text())).toEqual([
      'Sonnet 5.5',
      'Opus 5.5',
      'Gemini 3.8 Flash',
      'Gemini 4 Argon',
    ]);
  });

  it('shows and saves the project model', async () => {
    wrapper = mount(ProjectHeader);
    const settings = useSettingsStore();
    const select = wrapper.get<HTMLSelectElement>('select');
    expect(select.element.value).toBe('claude-sonnet-5-5');
    await select.setValue('claude-opus-5-5');
    expect(settings.projectModel).toBe('claude-opus-5-5');
    expect(JSON.parse(localStorage.getItem('describe.v1.prefs') ?? '{}')).toMatchObject({
      projectModel: 'claude-opus-5-5',
    });
    await select.setValue('gemini-4-argon');
    expect(settings.projectProvider).toBe('gemini');
  });

  describe('chat settings (D48)', () => {
    const groupOf = (legend: string) => {
      const group = wrapper!.findAll('fieldset').find((f) => f.get('legend').text() === legend);
      if (!group) throw new Error(`no group ${legend}`);
      return group;
    };
    const labels = (legend: string) =>
      groupOf(legend)
        .findAll('label')
        .map((l) => l.text());
    const checked = (legend: string) =>
      groupOf(legend)
        .findAll<HTMLInputElement>('input')
        .filter((i) => i.element.checked)
        .map((i) => i.element.value);

    it('the button opens a popover with the three settings, at Medium', () => {
      wrapper = mount(ProjectHeader);
      const button = wrapper.get('button[aria-label="Chat settings"]');
      const panel = wrapper.get('[popover]');
      expect(button.attributes('popovertarget')).toBe(panel.attributes('id'));
      expect(labels('Effort')).toEqual(['Low', 'Medium', 'High']);
      expect(labels('Tool calls')).toEqual(['15', '30', '60']);
      expect(labels('Reading')).toEqual([
        '10 h of transcript',
        '20 h of transcript',
        '40 h of transcript',
      ]);
      for (const legend of ['Effort', 'Tool calls', 'Reading']) {
        expect(checked(legend)).toEqual(['medium']);
      }
    });

    it('says what each setting does, in the description of its group', () => {
      wrapper = mount(ProjectHeader);
      const tip = (legend: string) =>
        wrapper!.get(`[id="${groupOf(legend).attributes('aria-describedby')}"]`);
      expect(tip('Effort').text()).toBe('How hard the model thinks at each step.');
      expect(tip('Tool calls').text()).toBe('How many searches and reads the model can make.');
      expect(tip('Reading').text()).toBe('How many hours of transcript the model can read.');
      expect(tip('Effort').attributes('role')).toBe('tooltip');
    });

    it('saves what is chosen', async () => {
      wrapper = mount(ProjectHeader);
      const settings = useSettingsStore();
      const choose = (legend: string, value: string) =>
        groupOf(legend).get(`input[value="${value}"]`).setValue(true);

      await choose('Effort', 'high');
      await choose('Tool calls', 'low');
      await choose('Reading', 'high');

      expect(settings.agentEffort).toBe('high');
      expect(settings.agentToolBudget).toBe('low');
      expect(settings.agentReadingBudget).toBe('high');
      expect(JSON.parse(localStorage.getItem('describe.v1.prefs') ?? '{}')).toMatchObject({
        agentEffort: 'high',
        agentToolBudget: 'low',
        agentReadingBudget: 'high',
      });
    });
  });

  it('Brief opens the dialog and Change shows the chooser', async () => {
    wrapper = mount(ProjectHeader);
    const ui = useProjectUi();
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(ui.briefOpen).toBe(true);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(ui.choosing).toBe(true);
  });
});

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
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Brief', 'Change']);
    const select = wrapper.get('select');
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Model');
    expect(
      select
        .findAll('optgroup')
        .map((g) => [g.attributes('label'), g.findAll('option').map((o) => o.text())]),
    ).toEqual([
      ['Claude', ['Sonnet 5.5', 'Opus 5.5']],
      ['Gemini', ['Gemini 3.8 Flash', 'Gemini 4 Argon']],
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

  it('Brief opens the dialog and Change shows the chooser', async () => {
    wrapper = mount(ProjectHeader);
    const ui = useProjectUi();
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(ui.briefOpen).toBe(true);
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(ui.choosing).toBe(true);
  });
});

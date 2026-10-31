import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useProjectStore } from '../../stores/project';
import { useTranslationStore } from '../../stores/translation';
import HomeView from './HomeView.vue';

describe('HomeView', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    // The settings store reads saved keys and prefs on creation.
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const modeButtons = () => wrapper!.findAll('button.mode');
  const status = () => wrapper!.find('.mode-status');

  it('has the hidden h1 that takes focus on a mode change, and the two modes', () => {
    wrapper = mount(HomeView);
    const h1 = wrapper.get('h1');
    expect(h1.text()).toBe('Home');
    expect(h1.classes()).toContain('visually-hidden');
    expect(h1.attributes('tabindex')).toBe('-1');
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(h1.attributes('id'));
    expect(modeButtons().map((b) => b.text())).toEqual(['Transcribe', 'Analyse']);
    expect(status().exists()).toBe(false);
  });

  it('enters the mode that is clicked', async () => {
    wrapper = mount(HomeView);
    const nav = useNavStore();
    await modeButtons()[0]!.trigger('click');
    expect(nav.mode).toBe('transcribe');
    await modeButtons()[1]!.trigger('click');
    expect(nav.mode).toBe('project');
  });

  it('says on the Transcribe button while a transcription runs', async () => {
    wrapper = mount(HomeView);
    const job = useJobStore();
    job.status = 'uploading';
    await wrapper.vm.$nextTick();
    expect(status().text()).toBe('Transcribing…');
    expect(modeButtons()[0]!.find('.mode-status').exists()).toBe(true);

    job.status = 'done';
    await wrapper.vm.$nextTick();
    expect(status().exists()).toBe(false);
  });

  it('says on the Transcribe button while a translation runs', async () => {
    wrapper = mount(HomeView);
    const translation = useTranslationStore();
    translation.status = 'running';
    await wrapper.vm.$nextTick();
    expect(status().text()).toBe('Translating…');
    expect(modeButtons()[0]!.find('.mode-status').exists()).toBe(true);

    translation.status = 'idle';
    await wrapper.vm.$nextTick();
    expect(status().exists()).toBe(false);
  });

  it("shows the remembered project's name on the Analyse button, without the busy dot", async () => {
    wrapper = mount(HomeView);
    useProjectStore().projectName = 'Hearing at home 2026';
    await wrapper.vm.$nextTick();
    const line = modeButtons()[1]!.get('.mode-status');
    expect(line.text()).toBe('Hearing at home 2026');
    expect(line.classes()).not.toContain('busy');
    expect(modeButtons()[0]!.find('.mode-status').exists()).toBe(false);
  });
});

import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App.vue';
import { useNavStore } from './stores/nav';
import { useSettingsStore } from './stores/settings';

describe('App shell', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

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

  const buttonNamed = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name)!;

  it('opens on Home, titled Home, with no steps, and with Settings in the footer', () => {
    wrapper = mount(App);
    expect(wrapper.find('h1').text()).toBe('Home');
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.get('header').text()).toBe('Home');
    expect(wrapper.get('header [aria-current="page"]').text()).toBe('Home');
    expect(wrapper.find('header button').exists()).toBe(false);
    expect(wrapper.get('footer').text()).toBe('Settings');
  });

  it('Transcribe shows the steps and Home returns to Home, moving focus each time', async () => {
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(document.activeElement?.tagName).not.toBe('H1');

    await buttonNamed('Transcribe').trigger('click');
    await flushPromises();
    expect(wrapper.find('nav[aria-label="Steps"]').exists()).toBe(true);
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Setup');

    const homeButton = wrapper.get('header button');
    expect(homeButton.text()).toBe('Home');
    await homeButton.trigger('click');
    await flushPromises();
    expect(wrapper.find('nav[aria-label="Steps"]').exists()).toBe(false);
    expect(wrapper.find('header button').exists()).toBe(false);
    expect(document.activeElement?.textContent).toBe('Home');
  });

  it('Project shows Home / Project and its first state', async () => {
    wrapper = mount(App, { attachTo: document.body });
    await buttonNamed('Analyse').trigger('click');
    await flushPromises();
    expect(
      wrapper
        .get('header')
        .findAll('button, .separator, [aria-current]')
        .map((el) => el.text()),
    ).toEqual(['Home', '/', 'Analyse']);
    expect(wrapper.find('nav[aria-label="Steps"]').exists()).toBe(false);
    expect(wrapper.get('header [aria-current="page"]').text()).toBe('Analyse');
    expect(document.activeElement?.textContent).toBe('Analyse');
    // happy-dom has no File System Access, so Project mode says which browsers can open projects.
    expect(wrapper.get('main').text()).toContain("This browser can't open project folders.");
  });

  it('shows the three steps with Output locked, and the version footer', () => {
    useNavStore().enter('transcribe');
    wrapper = mount(App);
    const buttons = wrapper.findAll('nav[aria-label="Steps"] button');
    expect(buttons.map((b) => b.text())).toEqual(['Setup', 'Glossary', 'Output']);
    expect(buttons.map((b) => b.attributes('disabled') !== undefined)).toEqual([
      false,
      false,
      true,
    ]);
    expect(buttons[0]?.attributes('aria-current')).toBe('step');
    expect(wrapper.find('h1').text()).toBe('Setup');
    expect(wrapper.get('footer').text()).toBe('Settings');
  });

  it('moves focus to the new view heading on step change, not on first load', async () => {
    useNavStore().enter('transcribe');
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(document.activeElement?.tagName).not.toBe('H1');

    const settings = useSettingsStore();
    settings.elevenLabsKey = 'test-key';
    settings.file = new File(['x'], 'a.wav', { type: 'audio/wav' });
    expect(useNavStore().goTo('glossary')).toBe(true);
    await flushPromises();

    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Glossary');
  });

  it('opens Settings from the footer, titled Home / Settings, and Back returns', async () => {
    wrapper = mount(App, { attachTo: document.body });
    await buttonNamed('Analyse').trigger('click');
    await flushPromises();

    await wrapper.get('footer button').trigger('click');
    await flushPromises();
    expect(useNavStore().mode).toBe('settings');
    expect(document.activeElement?.textContent).toBe('Settings');
    expect(wrapper.get('header [aria-current="page"]').text()).toBe('Settings');
    // The top row names it, so the footer link is gone.
    expect(wrapper.find('footer').exists()).toBe(false);

    await buttonNamed('Back').trigger('click');
    await flushPromises();
    expect(useNavStore().mode).toBe('project');
    expect(wrapper.find('footer').exists()).toBe(true);
  });
});

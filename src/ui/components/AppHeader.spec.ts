import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useNavStore } from '../../stores/nav';
import AppHeader from './AppHeader.vue';

describe('AppHeader', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  /** Each place in the path: its text, its position (`--at`), and whether it folds away while the row is closed. */
  const places = () =>
    wrapper!.findAll('.slot').map((slot) => ({
      text: slot.text(),
      at: (slot.element as HTMLElement).style.getPropertyValue('--at'),
      fold: slot.classes('fold'),
    }));

  const lastPlace = () =>
    (wrapper!.get('header').element as HTMLElement).style.getPropertyValue('--last');

  it('on Home, names Home and has nothing to unfold', () => {
    wrapper = mount(AppHeader);
    expect(places()).toEqual([{ text: 'Home', at: '0', fold: false }]);
    expect(lastPlace()).toBe('0');
  });

  it('in Transcribe, keeps only the current step unfolded, the places numbered left to right', async () => {
    const nav = useNavStore();
    nav.enter('transcribe');
    wrapper = mount(AppHeader);
    expect(places()).toEqual([
      { text: 'Home', at: '0', fold: true },
      { text: '/', at: '1', fold: true },
      { text: 'Setup', at: '2', fold: false },
      { text: '/', at: '3', fold: true },
      { text: 'Glossary', at: '4', fold: true },
      { text: '/', at: '5', fold: true },
      { text: 'Output', at: '6', fold: true },
    ]);
    expect(lastPlace()).toBe('6');

    nav.goTo('glossary');
    await nextTick();
    expect(places().filter((p) => !p.fold)).toEqual([{ text: 'Glossary', at: '4', fold: false }]);
  });

  it('in Settings, folds Home and its separator, leaving Settings', () => {
    useNavStore().openSettings();
    wrapper = mount(AppHeader);
    expect(places()).toEqual([
      { text: 'Home', at: '0', fold: true },
      { text: '/', at: '1', fold: true },
    ]);
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Settings');
    expect(lastPlace()).toBe('2');
  });

  it('opening a workspace from Home shows its page without a swap', async () => {
    const nav = useNavStore();
    wrapper = mount(AppHeader);
    nav.enter('transcribe');
    await nextTick();
    expect(wrapper.get('header').classes('swapping')).toBe(false);
    expect(places().filter((p) => !p.fold)).toEqual([{ text: 'Setup', at: '2', fold: false }]);
  });

  it('swaps the names together while the page changes', async () => {
    vi.useFakeTimers();
    const nav = useNavStore();
    nav.enter('transcribe');
    wrapper = mount(AppHeader);
    const header = () => wrapper!.get('header');
    expect(header().classes('swapping')).toBe(false);

    nav.goTo('glossary');
    await nextTick();
    expect(header().classes('swapping')).toBe(true);

    vi.advanceTimersByTime(260);
    await nextTick();
    expect(header().classes('swapping')).toBe(false);
  });
});

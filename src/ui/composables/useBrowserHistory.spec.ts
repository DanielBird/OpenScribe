import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useNavStore } from '../../stores/nav';
import { toLocation, useBrowserHistory } from './useBrowserHistory';
import { resetProjectUi, useProjectUi } from './useProjectUi';

const Host = defineComponent({
  setup() {
    useBrowserHistory();
    return () => null;
  },
});

describe('useBrowserHistory', () => {
  let wrapper: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    // The settings store reads saved keys and prefs on creation.
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    resetProjectUi();
    history.replaceState(null, '');
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  function start() {
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    wrapper = mount(Host);
    return { replace, push };
  }

  /** What the browser does on Back or Forward: the entry becomes current, then `popstate` fires. */
  async function pop(state: unknown): Promise<void> {
    history.replaceState(state, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
    await flushPromises();
  }

  it('makes the current entry Home on start', () => {
    const { replace, push } = start();
    expect(replace).toHaveBeenCalledWith({ mode: 'home' }, '');
    expect(push).not.toHaveBeenCalled();
    expect(history.state).toEqual({ mode: 'home' });
  });

  it('pushes one entry per page change, with no URL', async () => {
    const { push } = start();
    const nav = useNavStore();

    nav.enter('transcribe');
    await flushPromises();
    nav.goTo('glossary');
    await flushPromises();
    nav.openSettings();
    await flushPromises();

    expect(push.mock.calls).toEqual([
      [{ mode: 'transcribe', step: 'setup' }, ''],
      [{ mode: 'transcribe', step: 'glossary' }, ''],
      [{ mode: 'settings' }, ''],
    ]);
  });

  it("doesn't push when only Transcribe's hidden step changes", async () => {
    const { push } = start();
    const nav = useNavStore();
    nav.openSettings();
    await flushPromises();
    push.mockClear();

    nav.resetStep();
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
  });

  it('pushes the selected summary in Project', async () => {
    const { push } = start();
    useNavStore().enter('project');
    await flushPromises();
    useProjectUi().selected = 'session-1';
    await flushPromises();
    expect(push).toHaveBeenLastCalledWith({ mode: 'project', selected: 'session-1' }, '');
  });

  it('Back shows the entry’s page without pushing', async () => {
    const { push } = start();
    const nav = useNavStore();
    nav.goTo('glossary');
    await flushPromises();
    push.mockClear();

    await pop({ mode: 'home' });
    expect(nav.mode).toBe('home');
    await pop({ mode: 'transcribe', step: 'glossary' });
    expect(nav.mode).toBe('transcribe');
    expect(nav.step).toBe('glossary');
    await pop({ mode: 'settings' });
    expect(nav.mode).toBe('settings');
    expect(push).not.toHaveBeenCalled();
  });

  it('an Output with nothing in it shows Setup and corrects the entry', async () => {
    const { push } = start();
    const nav = useNavStore();

    await pop({ mode: 'transcribe', step: 'output' });
    expect(nav.mode).toBe('transcribe');
    expect(nav.step).toBe('setup');
    expect(history.state).toEqual({ mode: 'transcribe', step: 'setup' });
    expect(push).not.toHaveBeenCalled();
  });

  it("a summary that isn't in the project opens Project without it", async () => {
    start();
    await pop({ mode: 'project', selected: 'gone' });
    expect(useNavStore().mode).toBe('project');
    expect(useProjectUi().selected).toBeNull();
    expect(history.state).toEqual({ mode: 'project', selected: null });
  });

  it('an entry from before the app ran shows Home', async () => {
    start();
    const nav = useNavStore();
    nav.enter('transcribe');
    await flushPromises();

    await pop(null);
    expect(nav.mode).toBe('home');
  });

  it('stops listening when unmounted', async () => {
    start();
    wrapper!.unmount();
    wrapper = null;
    await pop({ mode: 'settings' });
    expect(useNavStore().mode).toBe('home');
  });
});

describe('toLocation', () => {
  it('reads valid entries and treats anything else as Home', () => {
    expect(toLocation({ mode: 'transcribe', step: 'output' })).toEqual({
      mode: 'transcribe',
      step: 'output',
    });
    expect(toLocation({ mode: 'project', selected: 'a' })).toEqual({
      mode: 'project',
      selected: 'a',
    });
    expect(toLocation({ mode: 'project', selected: 3 })).toEqual({
      mode: 'project',
      selected: null,
    });
    expect(toLocation({ mode: 'transcribe', step: 'nope' })).toEqual({ mode: 'home' });
    expect(toLocation({ mode: 'elsewhere' })).toEqual({ mode: 'home' });
    expect(toLocation('home')).toEqual({ mode: 'home' });
    expect(toLocation(null)).toEqual({ mode: 'home' });
  });
});

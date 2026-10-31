import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_MESSAGES, usePlaybackStore } from '../../stores/playback';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc, TEST_SOURCE } from '../../testing/transcriptDoc';
import AudioBar from './AudioBar.vue';
import FileDrop from './FileDrop.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

const SOURCE_FILE = () =>
  new File([new Uint8Array(TEST_SOURCE.fileSize)], TEST_SOURCE.fileName, { type: 'audio/mpeg' });
const OTHER_FILE = () => new File(['x'], 'other.wav', { type: 'audio/wav' });

describe('AudioBar', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    await useTranscriptStore().setDoc(makeDoc());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    usePlaybackStore().$dispose();
    useTranscriptStore().$dispose();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mountBar = () => {
    wrapper = mount(AudioBar, { attachTo: document.body });
    return wrapper;
  };
  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
  const pick = async (file: File, index = 0) => {
    wrapper!.findAllComponents(FileDrop)[index]!.vm.$emit('select', file);
    await flushPromises();
  };
  const dialog = () => wrapper!.get('dialog');

  /** The bar with the run's recording attached. */
  async function withAudio() {
    usePlaybackStore().attachFromRunFile(SOURCE_FILE());
    mountBar();
    await flushPromises();
    return wrapper!.get<HTMLAudioElement>('audio');
  }

  describe('without audio', () => {
    it('offers to attach the recording', () => {
      mountBar();
      expect(wrapper!.get('section').attributes('aria-label')).toBe('Playback');
      expect(wrapper!.get('.prompt').text()).toBe('Attach the recording to listen along.');
      expect(button('Choose file…')).toBeDefined();
      expect(wrapper!.find('audio').exists()).toBe(false);
    });

    it("attaches the transcript's recording without asking", async () => {
      mountBar();
      await pick(SOURCE_FILE());
      expect(dialog().attributes('open')).toBeUndefined();
      expect(usePlaybackStore().sourceMatch).toBe('matched');
      expect(wrapper!.get('audio').attributes('src')).toBe('blob:audio');
      expect(wrapper!.find('.hint').exists()).toBe(false);
    });

    it('asks before attaching another file, and says so once attached', async () => {
      mountBar();
      await pick(OTHER_FILE());
      expect(dialog().attributes('open')).toBeDefined();
      expect(dialog().get('h2').text()).toBe('Use this recording?');
      expect(dialog().get('p').text()).toBe(
        `It doesn't match the transcript's recording ("${TEST_SOURCE.fileName}").`,
      );
      await dialog()
        .findAll('button')
        .find((b) => b.text() === 'Use it')!
        .trigger('click');
      await flushPromises();
      expect(usePlaybackStore().sourceMatch).toBe('mismatch');
      expect(wrapper!.get('.hint').text()).toBe("Not the transcript's recording.");
      expect(button('Choose another file…')).toBeDefined();
    });

    it('attaches nothing when the user cancels', async () => {
      mountBar();
      await pick(OTHER_FILE());
      await dialog()
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
        .trigger('click');
      await flushPromises();
      expect(usePlaybackStore().audioUrl).toBeNull();
      expect(wrapper!.find('audio').exists()).toBe(false);
    });
  });

  describe('with audio', () => {
    it('shows the native player, registered with the store', async () => {
      const audio = await withAudio();
      expect(audio.attributes('controls')).toBeDefined();
      expect(audio.attributes('preload')).toBe('metadata');
      usePlaybackStore().seekTo(6);
      expect(audio.element.currentTime).toBe(6);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    });

    it("names the speaker of the turn being played, with the speaker's colour", async () => {
      await withAudio();
      expect(wrapper!.find('.speaker').exists()).toBe(false);
      const turns = makeDoc().turns;
      usePlaybackStore().seekTo(turns[1]!.start);
      await flushPromises();
      expect(wrapper!.get('.speaker').text()).toBe('Speaker 2');
      expect(wrapper!.get('.speaker').attributes('style')).toContain(
        '--speaker-color: var(--speaker-2)',
      );
    });

    it('offers no replacement for a matching recording', async () => {
      await withAudio();
      expect(button('Choose another file…')).toBeUndefined();
    });

    it('explains a format the browser cannot play, and offers another file', async () => {
      await withAudio();
      usePlaybackStore().playbackError = PLAYBACK_MESSAGES.unplayable;
      await flushPromises();
      expect(wrapper!.get('[role="alert"]').text()).toBe(PLAYBACK_MESSAGES.unplayable);
      expect(button('Choose another file…')).toBeDefined();
    });

    it('saves the Follow playback choice', async () => {
      await withAudio();
      const box = wrapper!.get<HTMLInputElement>('.follow input[type="checkbox"]');
      expect(box.element.checked).toBe(true);
      await box.setValue(false);
      expect(useSettingsStore().followPlayback).toBe(false);
    });

    it('shows the play/pause shortcut', async () => {
      await withAudio();
      expect(wrapper!.find('details').exists()).toBe(false);
      expect(wrapper!.get('.shortcut').text()).toBe('Space: play or pause');
    });

    it('unregisters the element when it unmounts', async () => {
      const audio = (await withAudio()).element;
      const register = vi.spyOn(usePlaybackStore(), 'registerAudioElement');
      wrapper!.unmount();
      wrapper = null;
      expect(register).toHaveBeenLastCalledWith(null);
      audio.currentTime = 9;
      audio.dispatchEvent(new Event('timeupdate'));
      expect(usePlaybackStore().currentTime).toBe(0);
    });
  });

  describe('keyboard', () => {
    const press = (
      key: string,
      target: EventTarget = document.body,
      init: KeyboardEventInit = {},
    ) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it.each([' ', 'k', 'K'])('"%s" plays and pauses', async (key) => {
      await withAudio();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      const event = press(key);
      expect(toggle).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ['an input', 'input'],
      ['a button', 'button'],
      ['a summary', 'summary'],
      ['a textarea', 'textarea'],
    ])('keeps its usual meaning in %s', async (_, tag) => {
      await withAudio();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      const el = document.createElement(tag);
      document.body.append(el);
      expect(press(' ', el).defaultPrevented).toBe(false);
      expect(press('k', el).defaultPrevented).toBe(false);
      expect(toggle).not.toHaveBeenCalled();
    });

    it('ignores modifier combinations and held keys', async () => {
      await withAudio();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      press('k', document.body, { ctrlKey: true });
      press('k', document.body, { altKey: true });
      press(' ', document.body, { repeat: true });
      expect(toggle).not.toHaveBeenCalled();
    });

    it('does nothing while a dialog is open', async () => {
      await withAudio();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      const open = document.createElement('dialog');
      open.setAttribute('open', '');
      document.body.append(open);
      press(' ');
      expect(toggle).not.toHaveBeenCalled();
    });

    it('does nothing without playable audio', async () => {
      mountBar();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      expect(press(' ').defaultPrevented).toBe(false);
      expect(toggle).not.toHaveBeenCalled();
    });

    it('stops listening once unmounted', async () => {
      await withAudio();
      const toggle = vi.spyOn(usePlaybackStore(), 'togglePlay');
      wrapper!.unmount();
      wrapper = null;
      press(' ');
      expect(toggle).not.toHaveBeenCalled();
    });
  });
});

import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalSttBridgeForTests } from '../../providers';
import { SpeechPackError, type LocalSttStatus } from '../../providers/transcription/local/bridge';
import { useSavedDataStore } from '../../stores/savedData';
import { fakeLocalBridge, TEST_PACK, type FakeBridge } from '../../testing/localBridge';
import SpeechPackSection from './SpeechPackSection.vue';

describe('SpeechPackSection', () => {
  let wrapper: VueWrapper | null = null;
  let bridge: FakeBridge;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('__DESKTOP__', true);
    setActivePinia(createPinia());
    bridge = fakeLocalBridge();
    setLocalSttBridgeForTests(bridge);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    setLocalSttBridgeForTests(null);
    vi.unstubAllGlobals();
  });

  async function mountWith(status: LocalSttStatus) {
    bridge.next = status;
    wrapper = mount(SpeechPackSection, { attachTo: document.body });
    await flushPromises();
    return wrapper;
  }

  const button = (name: string) =>
    wrapper!.findAll('.band-content button').find((b) => b.text() === name);
  const live = () => wrapper!.get('[aria-live="polite"]').text();

  it('offers the download with its size when the models are missing', async () => {
    await mountWith({ state: 'missing', pack: TEST_PACK });
    expect(wrapper!.get('h2').text()).toBe('Transcribe on this computer');
    expect(wrapper!.text()).toContain(
      'Transcribes without ElevenLabs, using speech models from NVIDIA.',
    );
    const download = button('Download speech models')!;
    const hint = wrapper!.get(`#${download.attributes('aria-describedby')}`);
    expect(hint.text()).toBe('0.8 GB from huggingface.co');
  });

  it('says what is wrong in each other state', async () => {
    const cases: [LocalSttStatus, string, string | null][] = [
      [{ state: 'ready', pack: TEST_PACK }, 'Speech models are installed.', 'Remove'],
      [
        { state: 'unusable', pack: TEST_PACK, reason: 'outdated' },
        'This version of DeScribe needs newer speech models.',
        'Download speech models',
      ],
      [
        { state: 'unusable', pack: TEST_PACK, reason: 'damaged' },
        'The speech models are damaged.',
        'Download again',
      ],
      [
        { state: 'unusable', pack: TEST_PACK, reason: 'cpu' },
        "This computer can't run the speech models.",
        null,
      ],
    ];
    for (const [status, text, action] of cases) {
      await mountWith(status);
      expect(wrapper!.text()).toContain(text);
      const buttons = wrapper!.findAll('.band-content button').map((b) => b.text());
      expect(buttons).toEqual(action ? [action] : []);
      wrapper!.unmount();
      wrapper = null;
    }
  });

  describe('the last recording on this computer (Phase 36)', () => {
    const record = {
      at: '2026-11-16T10:00:00.000Z',
      audioSec: 3730,
      timings: {
        decodeSec: 4.25,
        wordsSec: 600,
        speakersSec: 410,
        totalSec: 872,
        threads: 8,
        peakMemoryBytes: 2_150_000_000,
      },
    };
    const ready: LocalSttStatus = { state: 'ready', pack: TEST_PACK };

    it('shows nothing before a run', async () => {
      await mountWith(ready);
      expect(wrapper!.text()).not.toContain('Last recording');
      expect(wrapper!.find('details').exists()).toBe(false);
    });

    it('shows the last run, with its timings behind a disclosure', async () => {
      localStorage.setItem('describe.v1.lastLocalRun', JSON.stringify(record));
      await mountWith(ready);
      expect(wrapper!.text()).toContain('Last recording: 01:02:10 of audio in 00:14:32.');
      const details = wrapper!.get('details');
      expect(details.attributes('open')).toBeUndefined();
      expect(details.get('summary').text()).toBe('Timings');
      const pairs = details
        .findAll('dt')
        .map((dt, i) => [dt.text(), details.findAll('dd')[i]!.text()]);
      expect(pairs).toEqual([
        ['Speed', '4.3× real time'],
        ['Reading the audio', '4.3 s'],
        ['Words', '600.0 s'],
        ['Speakers', '410.0 s'],
        ['Total', '872.0 s'],
        ['Threads', '8'],
        ['Peak memory', '2.15 GB'],
      ]);
    });

    it('says when peak memory was not measured', async () => {
      localStorage.setItem(
        'describe.v1.lastLocalRun',
        JSON.stringify({ ...record, timings: { ...record.timings, peakMemoryBytes: null } }),
      );
      await mountWith(ready);
      expect(wrapper!.text()).toContain('Not measured');
    });

    it('is gone after Clear saved data', async () => {
      localStorage.setItem('describe.v1.lastLocalRun', JSON.stringify(record));
      await mountWith(ready);
      await useSavedDataStore().clearSavedData();
      await flushPromises();
      expect(wrapper!.text()).not.toContain('Last recording');
      expect(localStorage.getItem('describe.v1.lastLocalRun')).toBeNull();
    });

    it('is shown only while the models are installed', async () => {
      localStorage.setItem('describe.v1.lastLocalRun', JSON.stringify(record));
      await mountWith({ state: 'missing', pack: TEST_PACK });
      expect(wrapper!.text()).not.toContain('Last recording');
    });
  });

  it('renders nothing but the heading until the status is known', async () => {
    bridge.status = () => new Promise(() => {});
    wrapper = mount(SpeechPackSection);
    await flushPromises();
    expect(wrapper.get('section').attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('.band-content > *')).toEqual([]);
  });

  it('shows the progress with Cancel, then the installed state', async () => {
    await mountWith({ state: 'missing', pack: TEST_PACK });
    await button('Download speech models')!.trigger('click');
    await flushPromises();
    expect(live()).toBe('Downloading the speech models.');
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    bridge.progress(340_000_000);
    await flushPromises();
    const bar = wrapper!.get('progress');
    expect(wrapper!.get(`#${bar.attributes('aria-labelledby')}`).text()).toBe('340 MB of 0.8 GB');
    expect((bar.element as HTMLProgressElement).value).toBe(340_000_000);

    bridge.next = { state: 'ready', pack: TEST_PACK };
    bridge.finish();
    await flushPromises();
    expect(wrapper!.text()).toContain('Speech models are installed.');
    expect(live()).toBe('Speech models installed.');
    expect(document.activeElement?.textContent?.trim()).toBe('Remove');
  });

  it('goes back to the download after Cancel, with no error', async () => {
    await mountWith({ state: 'missing', pack: TEST_PACK });
    await button('Download speech models')!.trigger('click');
    await flushPromises();
    await button('Cancel')!.trigger('click');
    await flushPromises();
    expect(button('Download speech models')).toBeDefined();
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    expect(live()).toBe('Download cancelled.');
  });

  it('shows each failure with Technical details and the button again', async () => {
    const messages = {
      blocked: "Your network didn't allow the download from huggingface.co.",
      offline: "Couldn't reach huggingface.co.",
      busy: 'Hugging Face is busy.',
      disk: 'Not enough disk space: the speech models need 0.8 GB.',
      mismatch: "The download didn't arrive intact.",
      gone: "This version of DeScribe can't download its speech models any more.",
    };
    for (const [kind, text] of Object.entries(messages)) {
      await mountWith({ state: 'missing', pack: TEST_PACK });
      await button('Download speech models')!.trigger('click');
      await flushPromises();
      bridge.finish(new SpeechPackError(kind as keyof typeof messages, `detail of ${kind}`));
      await flushPromises();
      expect(wrapper!.get('[role="alert"]').text()).toContain(text);
      expect(wrapper!.get('details summary').text()).toBe('Technical details');
      expect(wrapper!.get('details pre').text()).toContain(`${kind}: detail of ${kind}`);
      expect(button('Download speech models')).toBeDefined();
      wrapper!.unmount();
      wrapper = null;
      setActivePinia(createPinia());
    }
  });

  it('asks before Remove, and does nothing on Cancel', async () => {
    await mountWith({ state: 'ready', pack: TEST_PACK });
    await button('Remove')!.trigger('click');
    await flushPromises();
    const dialog = wrapper!.get('dialog');
    expect(dialog.text()).toContain('Remove the speech models?');
    expect(dialog.text()).toContain('0.8 GB');
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click');
    await flushPromises();
    expect(bridge.calls).not.toContain('remove');

    await button('Remove')!.trigger('click');
    await flushPromises();
    bridge.next = { state: 'missing', pack: TEST_PACK };
    await wrapper!
      .get('dialog')
      .findAll('button')
      .find((b) => b.text() === 'Remove')!
      .trigger('click');
    await flushPromises();
    expect(bridge.calls).toContain('remove');
    expect(button('Download speech models')).toBeDefined();
    expect(live()).toBe('Speech models removed.');
  });
});

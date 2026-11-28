import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalSttBridgeForTests } from '../../providers';
import { SpeechPackError, type LocalSttStatus } from '../../providers/transcription/local/bridge';
import { useSavedDataStore } from '../../stores/savedData';
import { useSettingsStore } from '../../stores/settings';
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
      [{ state: 'ready', pack: TEST_PACK }, 'Speech models are installed.', 'Remove models'],
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
        device: null,
        peakMemoryBytes: 2_150_000_000,
        fellBack: null,
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
        ['Ran on', 'Processor (8 threads)'],
        ['Peak memory', '2.15 GB'],
      ]);
    });

    it('says which card a run on one ran on, as Run on names it, and reads an older record as the processor', async () => {
      const ranOn = () => {
        const dts = wrapper!.findAll('dt');
        const i = dts.findIndex((dt) => dt.text() === 'Ran on');
        return wrapper!.findAll('dd')[i]!.text();
      };
      localStorage.setItem(
        'describe.v1.lastLocalRun',
        JSON.stringify({
          ...record,
          // The second of two identical cards (audit GPU-6).
          timings: {
            ...record.timings,
            threads: null,
            device: { name: 'NVIDIA RTX A2000', nth: 1 },
          },
        }),
      );
      await mountWith(ready);
      expect(ranOn()).toBe('NVIDIA RTX A2000 (2)');
      wrapper!.unmount();
      const { device: _device, fellBack: _fellBack, ...before } = record.timings;
      localStorage.setItem(
        'describe.v1.lastLocalRun',
        JSON.stringify({ ...record, timings: before }),
      );
      setActivePinia(createPinia());
      await mountWith(ready);
      expect(ranOn()).toBe('Processor (8 threads)');
    });

    it('says when a run fell back to the processor, and why (audit GPU-3)', async () => {
      const fellBack = {
        device: { name: 'NVIDIA RTX A2000', nth: 1 },
        reason: 'the Vulkan engine found no graphics card',
      };
      localStorage.setItem(
        'describe.v1.lastLocalRun',
        JSON.stringify({ ...record, timings: { ...record.timings, fellBack } }),
      );
      await mountWith(ready);
      const details = wrapper!.get('details');
      const pairs = details
        .findAll('dt')
        .map((dt, i) => [dt.text(), details.findAll('dd')[i]!.text()]);
      expect(pairs).toContainEqual(['Ran on', 'Processor (8 threads), not NVIDIA RTX A2000 (2)']);
      expect(pairs).toContainEqual(['Why', 'the Vulkan engine found no graphics card']);
      // Decision 5: no message, only the Timings.
      expect(wrapper!.get('.last-run > p').text()).toBe(
        'Last recording: 01:02:10 of audio in 00:14:32.',
      );
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

  describe('Run on (Phase 37)', () => {
    const ready: LocalSttStatus = { state: 'ready', pack: TEST_PACK };
    const RTX = { name: 'NVIDIA GeForce RTX 2070 SUPER', kind: 'gpu', memoryBytes: 8e9 } as const;
    const UHD = {
      name: 'Intel(R) UHD Graphics 770',
      kind: 'integrated-gpu',
      memoryBytes: 0,
    } as const;
    const radios = () =>
      wrapper!.findAll('input[type="radio"]').map((r) => ({
        label: r.element.parentElement!.textContent!.trim(),
        checked: (r.element as HTMLInputElement).checked,
      }));

    it('is not offered without a card', async () => {
      await mountWith(ready);
      expect(bridge.calls).toContain('devices');
      expect(wrapper!.find('fieldset').exists()).toBe(false);
    });

    it('asks for the cards only once the models are ready', async () => {
      bridge.nextDevices = [RTX];
      await mountWith({ state: 'missing', pack: TEST_PACK });
      expect(bridge.calls).not.toContain('devices');
      expect(wrapper!.find('fieldset').exists()).toBe(false);
    });

    it('offers the processor, checked, then each card by name', async () => {
      bridge.nextDevices = [RTX, UHD];
      await mountWith(ready);
      const group = wrapper!.get('fieldset');
      expect(group.get('legend').text()).toBe('Run on');
      expect(radios()).toEqual([
        { label: 'Processor', checked: true },
        { label: RTX.name, checked: false },
        { label: UHD.name, checked: false },
      ]);
    });

    it('saves the card chosen, and checks the processor while the saved card is gone', async () => {
      bridge.nextDevices = [RTX, UHD];
      await mountWith(ready);
      await wrapper!.findAll('input[type="radio"]')[2]!.setValue(true);
      expect(useSettingsStore().localDevice).toEqual({ name: UHD.name, nth: 0 });
      wrapper!.unmount();
      setActivePinia(createPinia());
      bridge.nextDevices = [RTX];
      await mountWith(ready);
      expect(radios().map((r) => r.checked)).toEqual([true, false]);
      expect(useSettingsStore().localDevice).toEqual({ name: UHD.name, nth: 0 });
    });

    it('saves the processor clicked while the saved card is gone, so the card doesn’t come back', async () => {
      useSettingsStore().setLocalDevice({ name: UHD.name, nth: 0 });
      bridge.nextDevices = [RTX];
      await mountWith(ready);
      const processor = wrapper!.findAll('input[type="radio"]')[0]!;
      expect((processor.element as HTMLInputElement).checked).toBe(true);
      await processor.trigger('click');
      expect(useSettingsStore().localDevice).toBe('cpu');
      wrapper!.unmount();
      setActivePinia(createPinia());
      bridge.nextDevices = [RTX, UHD];
      await mountWith(ready);
      expect(radios().map((r) => r.checked)).toEqual([true, false, false]);
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
    expect(document.activeElement?.textContent?.trim()).toBe('Remove models');
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
      write: "DeScribe couldn't save the speech models.",
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

  it('asks before Remove models, and does nothing on Cancel', async () => {
    await mountWith({ state: 'ready', pack: TEST_PACK });
    await button('Remove models')!.trigger('click');
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

    await button('Remove models')!.trigger('click');
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

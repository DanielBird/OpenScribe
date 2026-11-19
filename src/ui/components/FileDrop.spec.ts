import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, shallowRef } from 'vue';
import { RecordingError, type DroppedRecording } from '../../desktop/recordings';
import type { FileCheck } from '../../domain/filecheck';
import FileDrop from './FileDrop.vue';

const OK: FileCheck = { ok: true, errors: [], warnings: [] };

// The desktop app's Rust side, faked (the web build's tests never reach it).
const recordings = vi.hoisted(() => ({
  chooseRecording: vi.fn<() => Promise<File | null>>(),
  dropListener: null as ((drop: DroppedRecording) => void) | null,
}));
vi.mock('../../desktop/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../desktop/recordings')>()),
  chooseRecording: recordings.chooseRecording,
  onDragOverWindow: () => () => {},
  onDroppedRecording: (listener: (drop: DroppedRecording) => void) => {
    recordings.dropListener = listener;
    return () => {
      recordings.dropListener = null;
    };
  },
}));

describe('FileDrop', () => {
  let wrapper: ReturnType<typeof mount<typeof FileDrop>> | null = null;

  function mountDrop(props: Partial<InstanceType<typeof FileDrop>['$props']> = {}) {
    wrapper = mount(FileDrop, {
      props: { file: null, durationSec: null, probing: false, check: null, ...props },
      attachTo: document.body,
    });
    return wrapper;
  }

  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
  const fileInput = () => wrapper!.get<HTMLInputElement>('input[type="file"]');

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('offers a Choose file button that opens the hidden file input', async () => {
    mountDrop();
    expect(fileInput().attributes('hidden')).toBeDefined();
    expect(fileInput().attributes('accept')).toBe('audio/*,video/*,.m4a,.wma,.mkv,.opus');
    const click = vi.spyOn(fileInput().element, 'click');
    await button('Choose file…')!.trigger('click');
    expect(click).toHaveBeenCalled();
  });

  it('emits the chosen file and resets the input', async () => {
    mountDrop();
    const file = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });
    const input = fileInput().element;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await fileInput().trigger('change');
    expect(wrapper!.emitted('select')).toEqual([[file]]);
    expect(input.value).toBe('');
  });

  it('emits the first dropped file', async () => {
    mountDrop();
    const file = new File(['x'], 'b.wav', { type: 'audio/wav' });
    const zone = wrapper!.get('[data-testid="drop-zone"]');
    await zone.trigger('dragenter', { dataTransfer: { types: ['Files'] } });
    expect(zone.classes()).toContain('is-dragging');
    await zone.trigger('drop', { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone.classes()).not.toContain('is-dragging');
    expect(wrapper!.emitted('select')).toEqual([[file]]);
  });

  it('ignores drags that carry no files', async () => {
    mountDrop();
    const zone = wrapper!.get('[data-testid="drop-zone"]');
    await zone.trigger('dragenter', { dataTransfer: { types: ['text/plain'] } });
    expect(zone.classes()).not.toContain('is-dragging');
  });

  it('stops a file dropped outside the zone from opening in the browser', () => {
    mountDrop();
    const stray = new Event('drop', { cancelable: true });
    window.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(true);

    wrapper!.unmount();
    wrapper = null;
    const afterUnmount = new Event('drop', { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('shows the name, size and duration of the selected file', () => {
    const file = new File([new Uint8Array(160_044)], 'tone-5s.wav', { type: 'audio/wav' });
    mountDrop({ file, durationSec: 5, check: OK });
    const text = wrapper!.get('dl').text();
    expect(text).toContain('tone-5s.wav');
    expect(text).toContain('156.3 KB');
    expect(text).toContain('00:00:05');
    expect(button('Choose another file…')).toBeDefined();
  });

  it('shows "Checking…" while probing and "unknown" when the duration could not be read', async () => {
    const file = new File(['x'], 'a.webm', { type: 'video/webm' });
    mountDrop({ file, probing: true });
    expect(wrapper!.get('dl').text()).toContain('Checking…');
    await wrapper!.setProps({ probing: false, durationSec: null });
    expect(wrapper!.get('dl').text()).toContain('unknown');
  });

  describe('compact', () => {
    it('is one line: the prompt and a button, no details or issue list', () => {
      const file = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });
      mountDrop({ compact: true, prompt: 'Attach the recording.', file, check: OK });
      expect(wrapper!.get('.prompt').text()).toBe('Attach the recording.');
      expect(button('Choose file…')).toBeDefined();
      expect(wrapper!.find('dl').exists()).toBe(false);
      expect(wrapper!.find('[role="status"]').exists()).toBe(false);
      expect(wrapper!.get('[data-testid="drop-zone"]').classes()).toContain('is-compact');
    });

    it('takes a button label and can leave out the prompt', () => {
      mountDrop({ compact: true, prompt: '', chooseLabel: 'Choose another file…' });
      expect(wrapper!.find('.prompt').exists()).toBe(false);
      expect(button('Choose another file…')).toBeDefined();
    });

    it('emits a chosen or dropped file', async () => {
      mountDrop({ compact: true });
      const file = new File(['x'], 'b.wav', { type: 'audio/wav' });
      await wrapper!
        .get('[data-testid="drop-zone"]')
        .trigger('drop', { dataTransfer: { types: ['Files'], files: [file] } });
      expect(wrapper!.emitted('select')).toEqual([[file]]);
    });
  });

  it('lists errors and warnings in an announced region', () => {
    const file = new File(['x'], 'a.xyz');
    mountDrop({
      file,
      check: { ok: false, errors: ['The file is too large.'], warnings: ['Unusual format.'] },
    });
    const status = wrapper!.get('[role="status"]');
    expect(status.get('li.error').text()).toBe('Error: The file is too large.');
    expect(status.get('li.warning').text()).toBe('Warning: Unusual format.');
  });

  it('emits remove and moves focus back to Choose file', async () => {
    // A parent that clears the file on remove, as SetupView does through the settings store.
    const onRemove = vi.fn();
    const Host = defineComponent(() => {
      const file = shallowRef<File | null>(new File(['x'], 'a.wav', { type: 'audio/wav' }));
      return () =>
        h(FileDrop, {
          file: file.value,
          durationSec: 1,
          probing: false,
          check: OK,
          onRemove: () => {
            onRemove();
            file.value = null;
          },
        });
    });
    const host = mount(Host, { attachTo: document.body });
    const remove = host.findAll('button').find((b) => b.text() === 'Remove')!;
    (remove.element as HTMLButtonElement).focus();
    await remove.trigger('click');
    await flushPromises();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent?.trim()).toBe('Choose file…');
    host.unmount();
  });

  describe('in the desktop app', () => {
    beforeEach(() => {
      vi.stubGlobal('__DESKTOP__', true);
      setActivePinia(createPinia());
      recordings.chooseRecording.mockReset();
    });

    afterEach(() => vi.unstubAllGlobals());

    const alert = () => wrapper!.find('[role="alert"]');
    const MESSAGE =
      "DeScribe couldn't open this file. Try again, or restart DeScribe if it keeps happening.";

    /** The zone covers 0–100 × 0–100 CSS pixels; happy-dom lays nothing out. */
    function mountOnDesktop(props: Partial<InstanceType<typeof FileDrop>['$props']> = {}) {
      mountDrop(props);
      const zone = wrapper!.get('[data-testid="drop-zone"]').element;
      vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    }

    it('emits the file the Open dialog chose', async () => {
      const file = new File(['x'], 'a.wav');
      recordings.chooseRecording.mockResolvedValueOnce(file);
      mountOnDesktop();
      await button('Choose file…')!.trigger('click');
      await flushPromises();
      expect(wrapper!.emitted('select')).toEqual([[file]]);
      expect(alert().exists()).toBe(false);
    });

    it("says when the chosen file couldn't be opened, until the next choice", async () => {
      recordings.chooseRecording
        .mockRejectedValueOnce(new RecordingError("couldn't hand the file to the page: refused"))
        .mockResolvedValueOnce(null);
      mountOnDesktop();
      await button('Choose file…')!.trigger('click');
      await flushPromises();
      expect(alert().text()).toBe(MESSAGE);
      expect(wrapper!.get('details pre').text()).toContain(
        "recording: couldn't hand the file to the page: refused",
      );
      expect(wrapper!.emitted('select')).toBeUndefined();

      await button('Choose file…')!.trigger('click');
      await flushPromises();
      expect(alert().exists()).toBe(false);
    });

    it('says so in the compact picker too', async () => {
      recordings.chooseRecording.mockRejectedValueOnce(new RecordingError('refused'));
      mountOnDesktop({ compact: true });
      await button('Choose file…')!.trigger('click');
      await flushPromises();
      expect(alert().text()).toBe(MESSAGE);
    });

    it("takes a drop on the zone, says why one couldn't be opened, and ignores drops elsewhere", async () => {
      mountOnDesktop();
      recordings.dropListener!({ error: new RecordingError('refused'), x: 500, y: 500 });
      await flushPromises();
      expect(alert().exists()).toBe(false);

      recordings.dropListener!({ error: new RecordingError('refused'), x: 50, y: 50 });
      await flushPromises();
      expect(alert().text()).toBe(MESSAGE);

      const file = new File(['x'], 'b.wav');
      recordings.dropListener!({ file, x: 50, y: 50 });
      await flushPromises();
      expect(wrapper!.emitted('select')).toEqual([[file]]);
      expect(alert().exists()).toBe(false);
    });
  });
});

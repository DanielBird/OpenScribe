import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingError, type DroppedRecording } from '../desktop/recordings';
import { ProviderError, technicalDetails } from '../providers/errors';
import { useDesktopRecordingStore, type DroppedOnWindow } from './desktopRecording';

const recordings = vi.hoisted(() => ({
  chooseRecording: vi.fn<() => Promise<File | null>>(),
  dropListener: null as ((drop: DroppedRecording) => void) | null,
}));
vi.mock('../desktop/recordings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../desktop/recordings')>()),
  chooseRecording: recordings.chooseRecording,
  onDragOverWindow: () => () => {},
  onDroppedRecording: (listener: (drop: DroppedRecording) => void) => {
    recordings.dropListener = listener;
    return () => {};
  },
}));

const MESSAGE =
  "DeScribe couldn't open this file. Try again, or restart DeScribe if it keeps happening.";

describe('the desktop recording store', () => {
  beforeEach(() => {
    vi.stubGlobal('__DESKTOP__', true);
    setActivePinia(createPinia());
    recordings.chooseRecording.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('gives the chosen file, or null when the user cancelled', async () => {
    const file = new File(['x'], 'a.wav');
    recordings.chooseRecording.mockResolvedValueOnce(file).mockResolvedValueOnce(null);
    const store = useDesktopRecordingStore();
    expect(await store.choose()).toEqual({ file });
    expect(await store.choose()).toBeNull();
  });

  it("says when the file couldn't be opened, with the detail for Technical details", async () => {
    recordings.chooseRecording.mockRejectedValueOnce(new RecordingError('the window was gone'));
    const chosen = await useDesktopRecordingStore().choose();
    const error = (chosen as { error: ProviderError }).error;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.userMessage).toBe(MESSAGE);
    expect(technicalDetails(error)).toBe('unknown\nrecording: the window was gone');
  });

  it('passes a dropped file on, and says why one failed', () => {
    const drops: DroppedOnWindow[] = [];
    useDesktopRecordingStore().onDrop((drop) => drops.push(drop));
    const file = new File(['x'], 'b.wav');
    recordings.dropListener!({ file, x: 1, y: 2 });
    recordings.dropListener!({ error: new RecordingError('refused'), x: 3, y: 4 });
    expect(drops[0]).toEqual({ file, x: 1, y: 2 });
    expect(drops[1]).toMatchObject({ x: 3, y: 4, error: { userMessage: MESSAGE } });
  });

  it('does nothing in the web build', async () => {
    vi.stubGlobal('__DESKTOP__', false);
    expect(await useDesktopRecordingStore().choose()).toBeNull();
    expect(recordings.chooseRecording).not.toHaveBeenCalled();
  });
});

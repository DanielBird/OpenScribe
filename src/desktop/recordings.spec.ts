import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage } from './ipc';
import {
  chooseRecording,
  onDroppedRecording,
  RecordingError,
  tokenOf,
  type DroppedRecording,
} from './recordings';

// What Rust does, faked: the command's reply, and the messages WebView2 delivers (src-tauri/src/stt/recording.rs).
const ipc = vi.hoisted(() => ({
  invokeCommand: vi.fn<(command: string) => Promise<unknown>>(),
  listener: null as ((message: HostMessage) => void) | null,
}));
vi.mock('./ipc', () => ({
  invokeCommand: ipc.invokeCommand,
  onHostMessage: (listener: (message: HostMessage) => void) => {
    ipc.listener = listener;
    return () => {};
  },
}));

// The module remembers tokens between tests, so each test uses its own.
let next = 0;
const newToken = () => (++next).toString(16).padStart(32, '0');
const handle = (file: File) => ({ kind: 'file', getFile: () => Promise.resolve(file) });
const refusingHandle = () => ({
  kind: 'file',
  getFile: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
});
const post = (data: unknown, objects: unknown[] = []) => ipc.listener!({ data, objects });
const chosen = (token: string) => ({ kind: 'describe.recording', token, via: 'dialog' });
const dropped = (token: string) => ({ kind: 'describe.recording', token, via: 'drop', x: 5, y: 6 });

/** Chooses with the command replying `token`, and waits until the page is waiting for the file. */
async function choosing(token: string): Promise<{ promise: Promise<File | null> }> {
  ipc.invokeCommand.mockResolvedValueOnce(token);
  const promise = chooseRecording();
  await vi.waitFor(() => expect(ipc.invokeCommand).toHaveBeenCalled());
  await Promise.resolve();
  return { promise }; // wrapped: an async function would wait for a returned promise
}

afterEach(() => {
  ipc.invokeCommand.mockReset();
  vi.useRealTimers();
});

describe('chooseRecording', () => {
  it('resolves with the file handed over, and remembers its token', async () => {
    const token = newToken();
    const { promise } = await choosing(token);
    const file = new File(['x'], 'a.wav');
    post(chosen(token), [handle(file)]);
    expect(await promise).toBe(file);
    expect(tokenOf(file)).toBe(token);
  });

  it('takes a file that arrived before the command returned', async () => {
    const token = newToken();
    const file = new File(['x'], 'a.wav');
    let reply: (value: unknown) => void = () => {};
    ipc.invokeCommand.mockReturnValueOnce(new Promise((resolve) => (reply = resolve)));
    const promise = chooseRecording();
    post(chosen(token), [handle(file)]);
    await vi.waitFor(() => expect(tokenOf(file)).toBe(token));
    reply(token);
    expect(await promise).toBe(file);
  });

  it('is null when the user cancels', async () => {
    ipc.invokeCommand.mockResolvedValueOnce(null);
    expect(await chooseRecording()).toBeNull();
  });

  it("rejects with Rust's detail when the dialog or the handover failed", async () => {
    ipc.invokeCommand.mockRejectedValueOnce({
      kind: 'recording',
      detail: "couldn't hand the file to the page: No such interface supported (0x80004002)",
    });
    const error = await chooseRecording().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecordingError);
    expect((error as RecordingError).detail).toBe(
      "couldn't hand the file to the page: No such interface supported (0x80004002)",
    );
  });

  it('rejects when the file comes without its handle', async () => {
    const token = newToken();
    const { promise } = await choosing(token);
    post(chosen(token));
    await expect(promise).rejects.toMatchObject({ detail: 'the file came without its handle' });
  });

  it('rejects when getFile() fails', async () => {
    const token = newToken();
    const { promise } = await choosing(token);
    post(chosen(token), [refusingHandle()]);
    await expect(promise).rejects.toMatchObject({
      detail: "couldn't open the file handed over: NotFoundError: gone",
    });
  });

  it('gives up when the file never arrives, and lets one that comes late go quietly', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error');
    const token = newToken();
    const { promise } = await choosing(token);
    const settled = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled).toMatchObject({ detail: 'the file never reached the page' });

    post(chosen(token), [handle(new File(['x'], 'late.wav'))]);
    await vi.advanceTimersByTimeAsync(0);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    const again = newToken();
    const { promise: next } = await choosing(again);
    const file = new File(['y'], 'b.wav');
    post(chosen(again), [handle(file)]);
    expect(await next).toBe(file);
  });

  it('rejects on a reply that is not a token', async () => {
    ipc.invokeCommand.mockResolvedValueOnce('../../etc/passwd');
    await expect(chooseRecording()).rejects.toBeInstanceOf(RecordingError);
  });
});

describe('dropped recordings', () => {
  function listen(): DroppedRecording[] {
    const drops: DroppedRecording[] = [];
    stop = onDroppedRecording((drop) => drops.push(drop));
    return drops;
  }
  let stop: () => void = () => {};
  afterEach(() => stop());

  it('hears each file dropped, with where it landed', async () => {
    const drops = listen();
    const token = newToken();
    const file = new File(['x'], 'c.wav');
    post(dropped(token), [handle(file)]);
    await vi.waitFor(() => expect(drops).toEqual([{ file, x: 5, y: 6 }]));
    expect(tokenOf(file)).toBe(token);
  });

  it("hears why when Rust couldn't hand a dropped file over", async () => {
    const drops = listen();
    post({ kind: 'describe.drop-failed', x: 1, y: 2, detail: 'refused' });
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]).toMatchObject({ x: 1, y: 2, error: { detail: 'refused' } });
    expect((drops[0] as { error: unknown }).error).toBeInstanceOf(RecordingError);
  });

  it('hears why when getFile() fails on a dropped file', async () => {
    const drops = listen();
    post(dropped(newToken()), [refusingHandle()]);
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]).toMatchObject({
      x: 5,
      y: 6,
      error: { detail: "couldn't open the file handed over: NotFoundError: gone" },
    });
  });
});

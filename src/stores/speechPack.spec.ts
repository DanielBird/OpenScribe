import 'fake-indexeddb/auto';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocalSttBridgeForTests } from '../providers';
import { SpeechPackError } from '../providers/transcription/local/bridge';
import { fakeLocalBridge, TEST_PACK, type FakeBridge } from '../testing/localBridge';
import { useSavedDataStore } from './savedData';
import { useSpeechPackStore } from './speechPack';

describe('the speech pack store', () => {
  let bridge: FakeBridge;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('__DESKTOP__', true);
    setActivePinia(createPinia());
    bridge = fakeLocalBridge();
    setLocalSttBridgeForTests(bridge);
  });

  afterEach(() => {
    setLocalSttBridgeForTests(null);
    vi.unstubAllGlobals();
  });

  it('does nothing in the web build', async () => {
    vi.stubGlobal('__DESKTOP__', false);
    const store = useSpeechPackStore();
    await store.refresh();
    expect(await store.download()).toBe('refused');
    expect(await store.remove()).toBe('refused');
    expect(bridge.calls).toEqual([]);
    expect(store.status).toBeNull();
  });

  it('reads the status, and the size from the pack', async () => {
    const store = useSpeechPackStore();
    await store.refresh();
    expect(store.status).toEqual({ state: 'missing', pack: TEST_PACK });
    expect(store.size).toBe('0.8 GB');
  });

  it('is checked once Rust answers, or fails to (audit BUG-6)', async () => {
    const store = useSpeechPackStore();
    bridge.hold();
    const first = store.refresh();
    expect(store.checked).toBe(false);
    bridge.release();
    await first;
    expect(store.checked).toBe(true);

    setActivePinia(createPinia());
    const failing = useSpeechPackStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.hold();
    const second = failing.refresh();
    bridge.release(new Error('no answer'));
    await second;
    expect(failing.status).toBeNull();
    expect(failing.checked).toBe(true);
    warn.mockRestore();
  });

  it('asks Rust once when asked twice at the same time', async () => {
    const store = useSpeechPackStore();
    await Promise.all([store.refresh(), store.refresh()]);
    expect(bridge.calls).toEqual(['status']);
  });

  it('downloads with progress, then reads the new status', async () => {
    const store = useSpeechPackStore();
    await store.refresh();
    const done = store.download();
    expect(store.busy).toBe('downloading');
    expect(store.progress).toEqual({ received: 0, total: TEST_PACK.downloadBytes });
    bridge.progress(340_000_000);
    expect(store.progress).toEqual({ received: 340_000_000, total: TEST_PACK.downloadBytes });
    bridge.next = { state: 'ready', pack: TEST_PACK };
    bridge.finish();
    await expect(done).resolves.toBe('installed');
    expect(store.busy).toBeNull();
    expect(store.progress).toBeNull();
    expect(store.status?.state).toBe('ready');
    expect(store.error).toBeNull();
  });

  it('refuses a second download while one runs', async () => {
    const store = useSpeechPackStore();
    const first = store.download();
    expect(await store.download()).toBe('refused');
    expect(await store.remove()).toBe('refused');
    bridge.finish();
    await first;
    expect(bridge.calls.filter((c) => c === 'download')).toHaveLength(1);
  });

  it('cancels quietly', async () => {
    const store = useSpeechPackStore();
    await store.refresh();
    const done = store.download();
    store.cancel();
    await expect(done).resolves.toBe('cancelled');
    expect(store.error).toBeNull();
    expect(store.busy).toBeNull();
  });

  it('keeps a failure with its message and detail until the next attempt', async () => {
    const store = useSpeechPackStore();
    await store.refresh();
    const done = store.download();
    bridge.finish(new SpeechPackError('disk', '921000000 bytes needed, 10 free'));
    await expect(done).resolves.toBe('failed');
    expect(store.error?.userMessage).toBe('Not enough disk space: the speech models need 0.8 GB.');
    expect(store.error?.opts.detail).toBe('disk: 921000000 bytes needed, 10 free');
    const again = store.download();
    expect(store.error).toBeNull();
    bridge.finish();
    await again;
  });

  it('removes the models, and reports a failure to', async () => {
    bridge.next = { state: 'ready', pack: TEST_PACK };
    const store = useSpeechPackStore();
    await store.refresh();
    bridge.next = { state: 'missing', pack: TEST_PACK };
    await expect(store.remove()).resolves.toBe('removed');
    expect(store.status?.state).toBe('missing');

    bridge.removeFails = new SpeechPackError('write', 'removing: access denied');
    await expect(store.remove()).resolves.toBe('failed');
    expect(store.error?.userMessage).toContain("couldn't remove the speech models");
  });

  it('shows a download Rust reports, as after coming back to Settings', async () => {
    bridge.next = { state: 'downloading', pack: TEST_PACK, receivedBytes: 5, totalBytes: 10 };
    const store = useSpeechPackStore();
    await store.refresh();
    expect(store.progress).toEqual({ received: 5, total: 10 });
  });

  it('is left alone by Clear saved data: the models aren’t the user’s data', async () => {
    const store = useSpeechPackStore();
    await store.refresh();
    await useSavedDataStore().clearSavedData();
    await flushPromises();
    expect(bridge.calls).not.toContain('remove');
  });
});

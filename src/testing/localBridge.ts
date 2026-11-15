// Test only: a scriptable LocalSttBridge (the desktop app's speech commands) for store and component specs.
import type {
  LocalSttBridge,
  LocalSttStatus,
  SpeechPackInfo,
} from '../providers/transcription/local/bridge';
import { SpeechPackError } from '../providers/transcription/local/bridge';

export const TEST_PACK: SpeechPackInfo = {
  id: 'nvidia-test-pack',
  version: '1.0.0',
  languages: ['en', 'de'],
  maxSpeakers: 8,
  downloadBytes: 820_987_584,
};

export interface FakeBridge extends LocalSttBridge {
  /** What `status()` answers next. */
  next: LocalSttStatus;
  calls: string[];
  /** Sends progress to the running download. */
  progress(receivedBytes: number, totalBytes?: number): void;
  /** Ends the running download: with an error kind, or successfully. */
  finish(error?: SpeechPackError): void;
  /** Makes `removeModels()` fail with this. */
  removeFails: SpeechPackError | null;
  /** Whether a download is waiting to be finished. */
  readonly downloading: boolean;
}

/** A bridge whose download waits until the test calls `finish()` (or the signal aborts). */
export function fakeLocalBridge(
  status: LocalSttStatus = { state: 'missing', pack: TEST_PACK },
): FakeBridge {
  let onProgress: ((r: number, t: number) => void) | null = null;
  let settle: ((error?: SpeechPackError) => void) | null = null;
  const bridge: FakeBridge = {
    next: status,
    calls: [],
    removeFails: null,
    get downloading() {
      return settle !== null;
    },
    status() {
      bridge.calls.push('status');
      return Promise.resolve(bridge.next);
    },
    transcribe() {
      return Promise.reject(new Error('not used here'));
    },
    download({ signal, onProgress: report }) {
      bridge.calls.push('download');
      onProgress = report;
      return new Promise<void>((resolve, reject) => {
        settle = (error) => {
          settle = null;
          onProgress = null;
          if (error) reject(error);
          else resolve();
        };
        signal.addEventListener(
          'abort',
          () => settle?.(new SpeechPackError('cancelled', 'cancelled')),
          { once: true },
        );
      });
    },
    removeModels() {
      bridge.calls.push('remove');
      return bridge.removeFails ? Promise.reject(bridge.removeFails) : Promise.resolve();
    },
    progress(receivedBytes, totalBytes = TEST_PACK.downloadBytes) {
      onProgress?.(receivedBytes, totalBytes);
    },
    finish(error) {
      settle?.(error);
    },
  };
  return bridge;
}

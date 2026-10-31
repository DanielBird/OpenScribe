// Pre-upload checks of the selected file against a provider's limits (DECISIONS.md D2).
import { formatTimestamp } from './transcript';

export interface FileCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface FileLimits {
  maxFileBytes: number;
  maxDurationSec: number;
  minDurationSec: number;
}

/** File extensions that ElevenLabs and browsers commonly handle. Others get a warning, not an error. */
export const KNOWN_MEDIA_EXTENSIONS: readonly string[] = [
  'mp3',
  'm4a',
  'wav',
  'aac',
  'flac',
  'ogg',
  'opus',
  'webm',
  'mp4',
  'mov',
  'mkv',
  'wma',
  'aiff',
];

/** Bytes → `512 B`, `1.5 KB`, `23.4 MB`, `3.0 GB` (binary units, one decimal). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function checkFile(
  info: { name: string; size: number; type: string; durationSec: number | null },
  limits: FileLimits,
): FileCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { size, durationSec } = info;

  if (size === 0) {
    errors.push('The file is empty. Choose another file.');
  } else if (size > limits.maxFileBytes) {
    errors.push(
      `The file is too large (${formatBytes(size)}). The limit is ${formatBytes(limits.maxFileBytes)}. ` +
        'Export only the audio, or use a compressed format such as MP3.',
    );
  }

  if (durationSec === null) {
    warnings.push("The recording's length couldn't be read. You can still try to transcribe it.");
  } else if (durationSec > limits.maxDurationSec) {
    errors.push(
      `The recording is too long (${formatTimestamp(durationSec)}). ` +
        `The limit is ${formatTimestamp(limits.maxDurationSec)}. Split it into shorter parts.`,
    );
  } else if (size > 0 && durationSec < limits.minDurationSec) {
    errors.push(
      `The recording is too short. It must be at least ${limits.minDurationSec} seconds long.`,
    );
  }

  const dot = info.name.lastIndexOf('.');
  const ext = dot > 0 ? info.name.slice(dot + 1).toLowerCase() : '';
  const isMediaType = /^(audio|video)\//.test(info.type);
  if (!KNOWN_MEDIA_EXTENSIONS.includes(ext) && !isMediaType) {
    warnings.push(
      ext
        ? `".${ext}" files are not a usual audio or video format, so the transcription may fail.`
        : 'The file has no extension, so it may not be an audio or video file.',
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

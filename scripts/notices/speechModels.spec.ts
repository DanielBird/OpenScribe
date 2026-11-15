// @vitest-environment node
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechModelsPart, speechModelsPartOf } from './speechModels.mjs';

const model = {
  role: 'words',
  file: 'words.gguf',
  bytes: 10,
  sha256: '0'.repeat(64),
  url: 'https://huggingface.co/nvidia/words/resolve/abc/words.gguf',
  name: 'NVIDIA Words',
  card: 'https://huggingface.co/nvidia/words',
  licence: 'Test-1.0',
  copyright: '© NVIDIA Corporation',
  changes: null as string | null,
};

const pack = (models = [model]) => ({ id: 'test-pack', version: '1.0.0', models });

const LICENCE =
  'Name: Test Licence 1.0\nURL: https://example.com/test-1.0\nText: https://example.com/test-1.0.txt\n' +
  'Retrieved: 2026-11-15\n\nTest Licence 1.0\r\n\r\n\r\n\r\nYou may share it.   \r\n';

describe('speechModelsPart', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'describe-notices-'));
    writeFileSync(join(dir, 'Test-1.0.txt'), LICENCE);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('credits each model and gives its licence, normalised', () => {
    const part = speechModelsPart(pack(), dir);
    expect(part.startsWith(`${'='.repeat(80)}\nSpeech models\n\n`)).toBe(true);
    expect(part).toContain(
      'NVIDIA Words (Test-1.0)\n© NVIDIA Corporation\nhttps://huggingface.co/nvidia/words\n' +
        "NVIDIA's own file, unchanged.\n" +
        `${'-'.repeat(80)}\nTest Licence 1.0\nhttps://example.com/test-1.0\n\n` +
        'Test Licence 1.0\n\nYou may share it.\n',
    );
    expect(part.endsWith('You may share it.\n')).toBe(true);
    expect(part).not.toContain('Retrieved:');
  });

  it('says how a changed file was changed', () => {
    const part = speechModelsPart(
      pack([{ ...model, changes: 'Converted to q8_0 by Dtype.' }]),
      dir,
    );
    expect(part).toContain('https://huggingface.co/nvidia/words\nConverted to q8_0 by Dtype.\n');
    expect(part).not.toContain('unchanged');
  });

  it('says once that DeScribe is not affiliated with NVIDIA, and gives a shared licence once', () => {
    const part = speechModelsPart(pack([model, { ...model, name: 'NVIDIA Speakers' }]), dir);
    const count = (s: string) => part.split(s).length - 1;
    expect(count('DeScribe is not affiliated with, sponsored by or endorsed by NVIDIA.')).toBe(1);
    expect(count('You may share it.')).toBe(1);
    expect(part).toContain('NVIDIA Words (Test-1.0)');
    expect(part).toContain('NVIDIA Speakers (Test-1.0)');
  });

  it('throws, naming the file, when a licence file is missing', () => {
    unlinkSync(join(dir, 'Test-1.0.txt'));
    expect(() => speechModelsPart(pack(), dir)).toThrow('scripts/notices/models/Test-1.0.txt');
  });

  it('throws when a licence file has no header', () => {
    writeFileSync(join(dir, 'Test-1.0.txt'), 'Just the text.\n');
    expect(() => speechModelsPart(pack(), dir)).toThrow('scripts/notices/models/Test-1.0.txt');
  });

  it('is found again in a notices file after the other notices', () => {
    const part = speechModelsPart(pack(), dir);
    const file = `Intro.\n\n${'='.repeat(80)}\nfoo 1.0 (MIT)\n\nMIT text\n\n${part}`;
    expect(speechModelsPartOf(file)).toBe(part);
    expect(speechModelsPartOf('Intro.\n')).toBeNull();
  });
});

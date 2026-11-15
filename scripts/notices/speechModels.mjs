// The Speech models part of THIRD-PARTY-NOTICES-DESKTOP.txt (Phase 35, D36): the models src-tauri/speech-pack/pack.json
// lists, each with its credit and its licence's full text from scripts/notices/models/<licence>.txt.
// A licence file starts with "Key: value" lines (Name, URL, Text: where the text was copied from, Retrieved), then a
// blank line, then the licence exactly as published.
// No work at import: scripts/make-notices.mjs and scripts/notices/speechModels.spec.ts call the exports.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULE = '='.repeat(80);
export const THIN_RULE = '-'.repeat(80);

/** The part's first two lines, which start it in the desktop file. */
export const SPEECH_MODELS_HEADING = `${RULE}\nSpeech models`;

const INTRO =
  'The DeScribe Windows app can download the speech models below from Hugging Face when you ask. Each is followed ' +
  'by its licence. DeScribe is not affiliated with, sponsored by or endorsed by NVIDIA.';

/** As scripts/make-notices.mjs normalises every licence text. */
export const normalise = (text) =>
  text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Where a model's licence lives, as the error messages name it. */
export const licenceFileName = (id) => `scripts/notices/models/${id}.txt`;

/** A licence file's header and text. Throws, naming the file, when it is missing or has no Name or URL. */
export function readLicence(id, licenceDir) {
  const file = join(licenceDir, `${id}.txt`);
  const name = licenceFileName(id);
  if (!existsSync(file)) {
    throw new Error(
      `${name} is missing. Copy the licence's full text there, with its URL and date at the top.`,
    );
  }
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const end = raw.indexOf('\n\n');
  const header = Object.fromEntries(
    (end === -1 ? raw : raw.slice(0, end))
      .split('\n')
      .map((line) => line.match(/^([A-Za-z]+):\s*(.+)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key.toLowerCase(), value.trim()]),
  );
  const text = end === -1 ? '' : normalise(raw.slice(end + 2));
  if (!header.name || !header.url || !text) {
    throw new Error(
      `${name} needs "Name:" and "URL:" lines, a blank line, then the licence's text.`,
    );
  }
  return { id, name: header.name, url: header.url, text };
}

/**
 * The Speech models part: a heading and the disclaimer, then each licence text once, under the models that use it
 * (in pack.json's order). Ends with a newline, like the rest of the file.
 */
export function speechModelsPart(pack, licenceDir) {
  const groups = new Map();
  for (const model of pack.models) {
    if (!groups.has(model.licence)) {
      groups.set(model.licence, { licence: readLicence(model.licence, licenceDir), models: [] });
    }
    groups.get(model.licence).models.push(model);
  }
  const sections = [...groups.values()].map(({ licence, models }) => {
    const headings = models.map((model) =>
      [
        `${model.name} (${model.licence})`,
        model.copyright,
        model.card,
        model.changes ?? "NVIDIA's own file, unchanged.",
      ].join('\n'),
    );
    return [
      RULE,
      headings.join('\n\n'),
      THIN_RULE,
      licence.name,
      licence.url,
      '',
      licence.text,
    ].join('\n');
  });
  return `${[`${SPEECH_MODELS_HEADING}\n\n${INTRO}`, ...sections].join('\n\n')}\n`;
}

/** The Speech models part of a notices file's text (from its heading to the end), or null when it has none. */
export function speechModelsPartOf(fileText) {
  const text = fileText.replace(/\r\n/g, '\n');
  const at = text.lastIndexOf(`\n${SPEECH_MODELS_HEADING}\n`);
  return at === -1 ? null : text.slice(at + 1);
}

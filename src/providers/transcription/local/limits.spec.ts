import { describe, expect, it } from 'vitest';
import pack from '../../../../src-tauri/speech-pack/pack.json';
import { MODEL_LICENCES, speechModelCredits } from './limits';

describe('speechModelCredits', () => {
  it('names every model in pack.json, with its card and a link for its licence', () => {
    const credits = speechModelCredits();
    expect(credits.map((c) => c.name)).toEqual(pack.models.map((m) => m.name));
    for (const credit of credits) {
      expect(credit.card).toMatch(/^https:\/\/huggingface\.co\/nvidia\//);
      expect(credit.licence.url).toBe(MODEL_LICENCES[credit.licence.id]!.url);
      expect(credit.copyright).toBe('© NVIDIA Corporation');
    }
  });

  it('knows every licence the pack uses', () => {
    for (const model of pack.models) expect(Object.keys(MODEL_LICENCES)).toContain(model.licence);
  });
});

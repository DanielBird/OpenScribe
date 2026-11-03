import { describe, expect, it } from 'vitest';
import {
  makeDoc,
  withFutureFields,
  withSourceHashes,
  withTranslation,
} from '../testing/transcriptDoc';
import { TranscriptDocSchema } from './schemas';

describe('TranscriptDocSchema', () => {
  it('keeps fields a newer build added, at every level (D38)', () => {
    const doc = withFutureFields(withTranslation(makeDoc()));
    expect(TranscriptDocSchema.parse(structuredClone(doc))).toEqual(doc);
  });

  it('reads a translation with or without the hashes of what it was made from (D39)', () => {
    const before = withTranslation(makeDoc());
    expect(TranscriptDocSchema.parse(structuredClone(before))).toEqual(before);
    const after = withSourceHashes(before);
    expect(TranscriptDocSchema.parse(structuredClone(after))).toEqual(after);
    expect(after.translations.en?.sourceHashes).toBeDefined();
  });

  it('still rejects a doc whose known fields are wrong', () => {
    const doc = withFutureFields(makeDoc());
    const turns = [{ ...doc.turns[0], start: 'soon' }];
    expect(TranscriptDocSchema.safeParse({ ...doc, turns }).success).toBe(false);
  });
});

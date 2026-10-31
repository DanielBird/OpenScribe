// Fixture-driven: ElevenLabs response → toNormalized → buildTranscriptDoc (phase 1 acceptance criterion 1).
import { describe, expect, it } from 'vitest';
import longMonologue from '../../fixtures/elevenlabs/long-monologue.json';
import nullSpeakers from '../../fixtures/elevenlabs/null-speakers.json';
import threeSpeakers from '../../fixtures/elevenlabs/three-speakers-en.json';
import twoSpeakers from '../../fixtures/elevenlabs/two-speakers-short.json';
import { toNormalized } from '../providers/transcription/elevenlabs/mapper';
import { buildTranscriptDoc } from './buildTranscriptDoc';
import type { SourceInfo, TranscriptDoc, TranscriptionRequestInfo } from './transcript';

const source: SourceInfo = {
  fileName: 'interview.m4a',
  fileSize: 1234,
  mimeType: 'audio/mp4',
  lastModified: 1_700_000_000_000,
  durationSec: 42,
};
const request: TranscriptionRequestInfo = {
  provider: 'elevenlabs',
  model: 'scribe_v2',
  languageHint: 'auto',
  numSpeakers: null,
  zeroRetention: false,
  keyterms: ['Oticon'],
};

function build(fixture: unknown): TranscriptDoc {
  return buildTranscriptDoc(toNormalized(fixture), source, request, {
    now: () => new Date('2026-10-13T09:00:00.000Z'),
    uuid: () => 'doc-uuid',
  });
}

/** [speakerId, start, end, text] per turn, with times rounded to avoid float noise. */
function summary(doc: TranscriptDoc) {
  return doc.turns.map((t) => [t.speakerId, round(t.start), round(t.end), t.text]);
}
const round = (x: number) => Math.round(x * 1000) / 1000;

describe('buildTranscriptDoc', () => {
  it('fills the document envelope from its inputs', () => {
    const doc = build(twoSpeakers);
    expect(doc).toMatchObject({
      schemaVersion: 1,
      id: 'doc-uuid',
      createdAt: '2026-10-13T09:00:00.000Z',
      source,
      request,
      result: {
        providerTranscriptId: 'fixture-two-speakers-short',
        languageCode: 'deu',
        languageProbability: 0.97,
        audioDurationSec: 16.6,
      },
      translations: {},
    });
  });

  it('uses crypto.randomUUID and the current time by default', () => {
    const doc = buildTranscriptDoc(toNormalized(twoSpeakers), source, request);
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(doc.createdAt)).not.toBeNaN();
  });

  it('two-speakers-short: German, two speakers, five turns', () => {
    const doc = build(twoSpeakers);
    expect(doc.speakers).toEqual([
      { id: 'speaker_0', label: 'Speaker 1' },
      { id: 'speaker_1', label: 'Speaker 2' },
    ]);
    expect(doc.turns.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(summary(doc)).toEqual([
      ['speaker_0', 0.2, 2.9, 'Guten Tag und willkommen zu unserem Gespräch.'],
      ['speaker_1', 3.5, 5.4, 'Danke, ich freue mich sehr.'],
      ['speaker_0', 6, 9.1, 'Wie lange arbeiten Sie schon an dem Projekt?'],
      ['speaker_1', 9.7, 13.2, 'Seit ungefähr zwei Jahren, gemeinsam mit einem kleinen Team.'],
      ['speaker_0', 13.8, 16.1, 'Was war bisher die größte Herausforderung?'],
    ]);
    expect(doc.turns[0]?.words).toHaveLength(7);
  });

  it('three-speakers-en: labels follow first appearance and same-speaker utterances merge', () => {
    const doc = build(threeSpeakers);
    expect(doc.speakers).toEqual([
      { id: 'speaker_2', label: 'Speaker 1' },
      { id: 'speaker_0', label: 'Speaker 2' },
      { id: 'speaker_1', label: 'Speaker 3' },
    ]);
    expect(summary(doc)).toEqual([
      ['speaker_2', 0.2, 2.5, 'Thanks for joining the review today.'],
      ['speaker_0', 3.1, 7, 'Happy to be here. I brought the latest test results.'],
      ['speaker_1', 7.6, 11.9, 'Same here, and I have a few questions about the schedule.'],
      [
        'speaker_2',
        12.5,
        18.1,
        "Great, let's start with the results. Then we can talk about the schedule.",
      ],
      ['speaker_0', 18.7, 22.6, 'The prototype passed all of the listening tests last week.'],
      ['speaker_1', 23.2, 26.3, 'That is good news for the launch plan.'],
      ['speaker_0', 26.9, 30, 'We still need to confirm the battery numbers.'],
      ['speaker_2', 30.6, 33.7, "Okay. Let's write that down as an action."],
    ]);
  });

  it('long-monologue: splits at the 90 s sentence end and at the 120 s hard limit', () => {
    const doc = build(longMonologue);
    expect(doc.speakers).toEqual([{ id: 'speaker_0', label: 'Speaker 1' }]);
    expect(doc.turns.map((t) => [round(t.start), round(t.end), t.words.length])).toEqual([
      [0, 94.9, 190],
      [95, 215.4, 241],
      [215.5, 299.9, 169],
    ]);
    expect(doc.turns[0]?.text.endsWith('.')).toBe(true); // split at a sentence end
    expect(doc.turns[1]?.text.endsWith('.')).toBe(false); // hard split mid-sentence
    expect(doc.turns.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('null-speakers: one unlabelled speaker, missing times filled in', () => {
    const doc = build(nullSpeakers);
    expect(doc.speakers).toEqual([{ id: 'speaker_0', label: 'Speaker 1' }]);
    expect(summary(doc)).toEqual([
      [
        'speaker_0',
        0.2,
        9,
        'This recording has no speaker labels at all. Some of the words also have no timing information, which the app must fill in.',
      ],
    ]);
    const words = doc.turns[0]?.words ?? [];
    const timesOf = (text: string) =>
      words.filter((w) => w.text === text).map((w) => [round(w.start), round(w.end)]);
    expect(timesOf('no')).toEqual([
      [1.4, 1.4], // both times missing: previous token's end
      [5.8, 6.1], // the second "no" is fully timed
    ]);
    expect(timesOf('of')).toEqual([[3.8, 4.1]]); // start missing: previous token's end
    expect(timesOf('in.')).toEqual([[9, 9]]); // end missing: its own start
    expect(words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))).toBe(true);
  });
});

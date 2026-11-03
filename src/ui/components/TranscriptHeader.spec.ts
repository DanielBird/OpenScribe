import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../domain/transcript';
import { makeDoc, TEST_REQUEST } from '../../testing/transcriptDoc';
import TranscriptHeader from './TranscriptHeader.vue';

const values = (doc = makeDoc()) =>
  mount(TranscriptHeader, { props: { doc } })
    .findAll('dd')
    .map((dd) => dd.text());

describe('TranscriptHeader', () => {
  it('shows the file name, duration, detected language, speakers and date', () => {
    const doc = makeDoc();
    const wrapper = mount(TranscriptHeader, { props: { doc } });
    expect(wrapper.get('h2').text()).toBe('interview.mp3');
    // ElevenLabs' own duration (16.6 s) wins over the probed one (17.5 s).
    expect(values(doc)).toEqual([
      '00:00:16',
      'German (97%)',
      '2 speakers',
      formatDateTime('2026-10-13T12:05:00.000Z'),
    ]);
    expect(wrapper.findAll('dt').map((dt) => dt.text())).toEqual([
      'Duration',
      'Language',
      'Speakers',
      'Transcribed',
    ]);
  });

  it('uses the probed duration when ElevenLabs gave none, and leaves it out if neither is known', () => {
    const doc = makeDoc();
    expect(values({ ...doc, result: { ...doc.result, audioDurationSec: null } })[0]).toBe(
      '00:00:17',
    );
    const unknown = {
      ...doc,
      source: { ...doc.source, durationSec: null },
      result: { ...doc.result, audioDurationSec: null },
    };
    expect(values(unknown)[0]).toBe('German (97%)');
  });

  it('leaves the language out when it is not known', () => {
    const doc = makeDoc();
    expect(values({ ...doc, result: { ...doc.result, languageCode: '' } })).toEqual([
      '00:00:16',
      '2 speakers',
      formatDateTime('2026-10-13T12:05:00.000Z'),
    ]);
  });

  it('shows the confidence only when the language was detected', () => {
    const doc = makeDoc({ request: { ...TEST_REQUEST, languageHint: 'de' } });
    expect(values(doc)).toContain('German');
  });

  it('adds the glossary and zero retention only when they were used', () => {
    const doc = makeDoc({
      request: { ...TEST_REQUEST, keyterms: ['Oticon', 'Philips'], zeroRetention: true },
      speakers: [{ id: 'speaker_0', label: 'Speaker 1' }],
    });
    expect(values(doc)).toEqual([
      '00:00:16',
      'German (97%)',
      '1 speaker',
      formatDateTime('2026-10-13T12:05:00.000Z'),
      '2 glossary terms',
      'Zero retention',
    ]);
  });
});

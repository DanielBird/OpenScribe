// Generates the synthetic ElevenLabs fixtures in fixtures/elevenlabs/ (no real recordings or personal data).
// Deterministic: re-running produces identical files. Usage: node scripts/make-elevenlabs-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../fixtures/elevenlabs/', import.meta.url));
const WORD_SEC = 0.3;
const GAP_SEC = 0.1;
const PAUSE_SEC = 0.6;

const r = (x) => Math.round(x * 1000) / 1000;
const logprob = (i) => -r((i % 7) * 0.013);

function token(text, start, end, type, speaker, lp = 0) {
  return { text, start: r(start), end: r(end), type, speaker_id: speaker, logprob: lp };
}

function response(name, languageCode, words, durationSec) {
  return {
    language_code: languageCode,
    language_probability: 0.97,
    text: words.map((w) => w.text).join(''),
    transcription_id: `fixture-${name}`,
    audio_duration_secs: r(durationSec),
    words,
  };
}

/** Utterances → word/spacing tokens. Pauses between utterances are spacing tokens of the earlier speaker. */
function dialogue(utterances, { leadingSpacing = false, trailingSpacing = false } = {}) {
  const words = [];
  let t = 0.2;
  if (leadingSpacing) words.push(token(' ', 0, t, 'spacing', utterances[0].speaker));
  let n = 0;
  utterances.forEach((u, ui) => {
    const parts = u.text.split(' ');
    parts.forEach((w, wi) => {
      words.push(token(w, t, t + WORD_SEC, 'word', u.speaker, logprob(n++)));
      t += WORD_SEC;
      const lastWord = wi === parts.length - 1;
      if (lastWord && ui === utterances.length - 1 && !trailingSpacing) return;
      const gap = lastWord ? PAUSE_SEC : GAP_SEC;
      words.push(token(' ', t, t + gap, 'spacing', u.speaker));
      t += gap;
    });
  });
  return { words, end: t };
}

function write(name, data) {
  let json;
  if (Array.isArray(data.words)) {
    // One token per line keeps the files reviewable and diff-friendly.
    const { words, ...rest } = data;
    const head = JSON.stringify(rest, null, 2).slice(0, -2);
    const body = words.map((w) => `    ${JSON.stringify(w)}`).join(',\n');
    json = `${head},\n  "words": [\n${body}\n  ]\n}\n`;
  } else {
    json = `${JSON.stringify(data, null, 2)}\n`;
  }
  writeFileSync(`${OUT}${name}.json`, json);
  console.log(`wrote fixtures/elevenlabs/${name}.json`);
}

mkdirSync(OUT, { recursive: true });

// 1. German, two speakers, five turns, with a leading spacing token.
{
  const { words, end } = dialogue(
    [
      { speaker: 'speaker_0', text: 'Guten Tag und willkommen zu unserem Gespräch.' },
      { speaker: 'speaker_1', text: 'Danke, ich freue mich sehr.' },
      { speaker: 'speaker_0', text: 'Wie lange arbeiten Sie schon an dem Projekt?' },
      {
        speaker: 'speaker_1',
        text: 'Seit ungefähr zwei Jahren, gemeinsam mit einem kleinen Team.',
      },
      { speaker: 'speaker_0', text: 'Was war bisher die größte Herausforderung?' },
    ],
    { leadingSpacing: true },
  );
  write('two-speakers-short', response('two-speakers-short', 'deu', words, end + 0.5));
}

// 2. English, three speakers whose ids appear out of numeric order (speaker_2 first), eight turns.
//    speaker_2 speaks twice in a row (two utterances, one turn). Ends with trailing spacing.
{
  const { words, end } = dialogue(
    [
      { speaker: 'speaker_2', text: 'Thanks for joining the review today.' },
      { speaker: 'speaker_0', text: 'Happy to be here. I brought the latest test results.' },
      { speaker: 'speaker_1', text: 'Same here, and I have a few questions about the schedule.' },
      { speaker: 'speaker_2', text: "Great, let's start with the results." },
      { speaker: 'speaker_2', text: 'Then we can talk about the schedule.' },
      { speaker: 'speaker_0', text: 'The prototype passed all of the listening tests last week.' },
      { speaker: 'speaker_1', text: 'That is good news for the launch plan.' },
      { speaker: 'speaker_0', text: 'We still need to confirm the battery numbers.' },
      { speaker: 'speaker_2', text: "Okay. Let's write that down as an action." },
    ],
    { trailingSpacing: true },
  );
  write('three-speakers-en', response('three-speakers-en', 'eng', words, end + 0.5));
}

// 3. One speaker, 600 words over 300 s: word i spans [0.5i, 0.5i + 0.4], spacing fills the rest.
//    Sentence ends after words 59, 119, 169, 189, 300, 500 and 599. With the 90 s / 120 s rules:
//    turn 1 = words 0–189 (0–94.9 s; the end at 84.9 s is not past 90 s, the one at 94.9 s is),
//    turn 2 = words 190–430 (95.0–215.4 s; its only sentence end is 55 s in, so the 120 s hard split
//    happens after word 430), turn 3 = words 431–599 (215.5–299.9 s, under 90 s).
{
  const vocab = [
    'the',
    'team',
    'tested',
    'new',
    'listening',
    'profiles',
    'in',
    'several',
    'quiet',
    'and',
    'noisy',
    'rooms',
    'with',
    'careful',
    'notes',
    'about',
    'comfort',
    'sound',
    'quality',
    'battery',
    'life',
  ];
  const sentenceEnds = new Set([59, 119, 169, 189, 300, 500, 599]);
  const words = [];
  for (let i = 0; i < 600; i++) {
    let w = vocab[i % vocab.length];
    if (i === 0 || sentenceEnds.has(i - 1)) w = w[0].toUpperCase() + w.slice(1);
    if (sentenceEnds.has(i)) w += '.';
    words.push(token(w, i * 0.5, i * 0.5 + 0.4, 'word', 'speaker_0', logprob(i)));
    if (i < 599) words.push(token(' ', i * 0.5 + 0.4, (i + 1) * 0.5, 'spacing', 'speaker_0'));
  }
  write('long-monologue', response('long-monologue', 'eng', words, 300.2));
}

// 4. No speaker labels at all, and some missing timestamps that segmentation must fill in.
{
  const { words, end } = dialogue([
    {
      speaker: null,
      text: 'This recording has no speaker labels at all. Some of the words also have no timing information, which the app must fill in.',
    },
  ]);
  const wordAt = (n) => words.filter((w) => w.type === 'word')[n];
  Object.assign(wordAt(3), { start: null, end: null }); // "no"
  Object.assign(wordAt(9), { start: null }); // "of"
  Object.assign(words[words.indexOf(wordAt(12)) + 1], { start: null, end: null }); // spacing after "also"
  Object.assign(wordAt(22), { end: null }); // "in."
  write('null-speakers', response('null-speakers', 'eng', words, end + 0.5));
}

// 5. German, two speakers taking 70 short turns in alternation: more than one translation batch (60 turns
//    each), so the e2e tests can stop and resume a translation between batches.
{
  const { words, end } = dialogue(
    Array.from({ length: 70 }, (_, i) => ({
      speaker: `speaker_${i % 2}`,
      text: `Das ist Beitrag ${i + 1} im Gespräch.`,
    })),
  );
  write('many-turns', response('many-turns', 'deu', words, end + 0.5));
}

// 6. English, matching fixtures/audio/tone-12s.wav (scripts/make-test-audio.mjs): four turns that start
//    exactly at 0, 3, 6 and 9 s, where the tone changes pitch, alternating between two speakers. For the
//    playback e2e tests, which click a turn and check the audio's currentTime.
{
  const lines = [
    'Low tone first.',
    'Then a higher one.',
    'Lower again here.',
    'The last tone ends.',
  ];
  const words = [];
  lines.forEach((line, li) => {
    const speaker = `speaker_${li % 2}`;
    let t = li * 3;
    line.split(' ').forEach((w, wi, parts) => {
      words.push(token(w, t, t + 0.5, 'word', speaker, logprob(words.length)));
      t += 0.5;
      if (wi < parts.length - 1 || li < lines.length - 1) {
        // The pause after a line lasts until the next tone; it belongs to the earlier speaker.
        const end = wi < parts.length - 1 ? t + 0.1 : (li + 1) * 3;
        words.push(token(' ', t, end, 'spacing', speaker));
        t = end;
      }
    });
  });
  write('tone-12s', { ...response('tone-12s', 'eng', words, 12), language_probability: 0.99 });
}

// 7. A recording with no speech: no tokens at all. Output says so and offers nothing to export.
write('silence', { ...response('silence', 'eng', [], 6), text: '', language_probability: 0.31 });

// 8. English, the API's maximum of 32 speakers, one sentence each: the speaker colours cycle and the
//    Speakers panel has to fit 32 names.
{
  const { words, end } = dialogue(
    Array.from({ length: 32 }, (_, i) => ({
      speaker: `speaker_${i}`,
      text: `This is speaker number ${i + 1} speaking.`,
    })),
  );
  write('thirty-two-speakers', response('thirty-two-speakers', 'eng', words, end + 0.5));
}

// 9. Error bodies in the shapes ElevenLabs uses. error-401, error-400-missing-file, error-400-invalid-keyword
//    and error-403-zero-retention were seen in the live checks of 2026-10-13 (V1–V3); only their request ids
//    are made up. For missing permissions only the status code was observed (V3), so its message text is
//    illustrative.
write('error-401', {
  detail: {
    type: 'authentication_error',
    code: 'unauthorized',
    message: 'Invalid API key',
    status: 'invalid_api_key',
    request_id: 'fixture-request-0003',
  },
});
write('error-400-missing-file', {
  detail: {
    type: 'validation_error',
    code: 'invalid_parameters',
    message: 'Must provide either file or a URL parameter.',
    status: 'invalid_parameters',
    request_id: 'fixture-request-0004',
    param: 'file',
  },
});
write('error-401-missing-permissions', {
  detail: {
    status: 'missing_permissions',
    message:
      'The API key you used is missing the permission speech_to_text to execute this operation.',
  },
});
write('error-400-invalid-keyword', {
  detail: {
    type: 'validation_error',
    code: 'invalid_parameters',
    message: 'Some keyword contains invalid characters',
    status: 'invalid_keyword',
    request_id: 'fixture-request-0001',
    param: 'keywords',
  },
});
write('error-403-zero-retention', {
  detail: {
    type: 'authorization_error',
    code: 'forbidden',
    message: 'Only users from the enterprise or trial tier can use ZRM mode.',
    status: 'not_allowed',
    request_id: 'fixture-request-0002',
  },
});
write('error-422', {
  detail: [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required', input: null }],
});
write('error-429', {
  detail: {
    status: 'too_many_concurrent_requests',
    message: 'Too many concurrent requests. Your plan allows 4 concurrent requests.',
  },
});

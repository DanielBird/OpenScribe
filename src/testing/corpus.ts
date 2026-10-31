// Test only: a generated project corpus of interview sessions, for search tests and the 300-hour benchmark.
// Deterministic and seeded like scripts/make-large-fixture.mjs. Not imported by the app. It imports only domain
// types, so Playwright can import it too.
import type { Speaker, TranscriptDoc, Turn, Word } from '../domain/transcript';

export type CorpusLanguage = 'en' | 'de' | 'fr';

export interface MakeCorpusOptions {
  /** Total length of the recordings, in sessions of 1–3 hours (a total under an hour is one shorter session). */
  hours: number;
  seed: number;
  /** Each session's language is picked from this list. Default: half English, then German, then French. */
  languages?: readonly CorpusLanguage[];
  /** Add word timings to every turn, for realistic file sizes. Default: `words: []`, which is much faster. */
  withWords?: boolean;
}

/** A phrase planted at a known turn, so tests can assert exact hits. */
export interface PlantedPhrase {
  phrase: string; // as written in the turn
  sessionId: string;
  turnId: string;
  start: number;
  field: 'english' | 'original'; // the text it is in
}

export interface GeneratedCorpus {
  docs: TranscriptDoc[];
  planted: PlantedPhrase[];
}

const DEFAULT_LANGUAGES: readonly CorpusLanguage[] = ['en', 'en', 'en', 'de', 'de', 'fr'];
const LANGUAGE_CODES: Record<CorpusLanguage, string> = { en: 'eng', de: 'deu', fr: 'fra' };

/** Seconds per word, and the pause between turns: about 8,300 words an hour (PROJECTS.md §3). */
const WORD_SEC = 0.4;
const PAUSE_SEC = 0.6;
/** Every this many turns, a respondent talks for a minute or more. */
const MONOLOGUE_EVERY = 40;
const FIRST_RECORDING = Date.UTC(2026, 8, 1, 9, 0, 0);
const DAY_MS = 86_400_000;

// None of the planted words ("charger", "bed", "Ladegerät", "Bett", "Hörgerät", "chargeur", "lit") is in a
// vocabulary, so a planted phrase is found only where it was planted.
const VOCABULARY: Record<CorpusLanguage, readonly string[]> = {
  en: (
    'the a we our I you it they them my their is was have had do did not very really quite just also still ' +
    'then so and but because maybe perhaps probably definitely hearing aid aids battery charge charging ' +
    'night evening morning day week phone app sound quality noise speech music television kitchen family ' +
    'partner doctor clinic appointment fitting audiologist settings program volume routine habit always ' +
    'sometimes never usually forget remember think know feel hear listen wear take put leave home work ' +
    'car table drawer box case comfortable tired loud quiet better worse easy hard new old first last'
  ).split(' '),
  de: (
    'ich wir das die der den dem und aber nicht sehr gut immer manchmal nie wirklich vielleicht also dann ' +
    'noch schon ganz genau eigentlich natürlich Akku laden aufladen Batterie nachts abends morgens heute ' +
    'gestern Woche Monat Gerät Geräusche hören zuhören tragen schön größer Straße über für Küche Arzt ' +
    'Hörakustiker Termin Einstellung Programm Lautstärke Handy Fernseher Familie Gespräch müde früh spät ' +
    'Tisch Schublade Etui laut leise besser schlechter einfach schwierig neu alt zuerst später Gewohnheit'
  ).split(' '),
  fr: (
    'je nous le la les et mais pas très bien toujours parfois jamais vraiment peut-être alors puis encore ' +
    "déjà aujourd'hui d'accord c'est l'appareil batterie charge recharger nuit soir matin semaine mois " +
    'hier téléphone télévision cuisine médecin audioprothésiste réglage programme volume famille ' +
    'conversation écouter entendre porter bruit fatigué tôt tard table tiroir étui fort doux mieux pire ' +
    "facile difficile nouveau ancien d'abord ensuite habitude là où ça grâce être été"
  ).split(' '),
};

const CITIES: Record<CorpusLanguage, readonly string[]> = {
  en: ['Leeds', 'Bristol', 'Glasgow', 'Cardiff', 'York'],
  de: ['Hamburg', 'Munich', 'Cologne', 'Leipzig', 'Bremen'],
  fr: ['Lyon', 'Lille', 'Nantes', 'Toulouse', 'Rennes'],
};
const KINDS = ['home visit', 'interview', 'kitchen interview', 'follow-up', 'diary review'];
const NAMES = ['Anna', 'Ben', 'Clara', 'David', 'Elif', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jonas'];
const ENDINGS = ['.', '.', '.', '.', '?', '!'];

interface Plant {
  language: CorpusLanguage;
  /** Which session of that language: 0 is the first. */
  nth: number;
  text: string;
  en: string | null; // the English translation of the turn, for a German or French session
  phrase: string;
  field: PlantedPhrase['field'];
}

const PLANTS: readonly Plant[] = [
  {
    language: 'en',
    nth: 0,
    text: 'Usually I put them on the charger by the bed.',
    en: null,
    phrase: 'charger by the bed',
    field: 'english',
  },
  {
    language: 'en',
    nth: 2,
    text: 'The charger by the bed, like my phone.',
    en: null,
    phrase: 'charger by the bed',
    field: 'english',
  },
  {
    language: 'en',
    nth: 4,
    text: 'Every night: the Charger by the bed!',
    en: null,
    phrase: 'Charger by the bed',
    field: 'english',
  },
  {
    language: 'de',
    nth: 1,
    text: 'Abends kommt es an das Ladegerät am Bett.',
    en: 'In the evening it goes on the charger by the bed.',
    phrase: 'charger by the bed',
    field: 'english',
  },
  {
    language: 'de',
    nth: 0,
    text: 'Ich lege es auf das Ladegerät neben dem Bett.',
    en: 'I put it on the charging station next to the bed.',
    phrase: 'Ladegerät neben dem Bett',
    field: 'original',
  },
  {
    language: 'de',
    nth: 2,
    text: 'Ich trage das Hörgerät nachts nie.',
    en: 'I never wear the hearing aid at night.',
    phrase: 'das Hörgerät nachts',
    field: 'original',
  },
  {
    language: 'fr',
    nth: 0,
    text: 'Je le pose sur le chargeur près du lit.',
    en: 'I put it on the charging base near the bed.',
    phrase: 'le chargeur près du lit',
    field: 'original',
  },
];

// mulberry32: a small seeded PRNG.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

function int(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(random: Random, list: readonly T[]): T {
  const item = list[Math.floor(random() * list.length)];
  if (item === undefined) throw new Error('pick: empty list');
  return item;
}

function hex(random: Random, digits: number): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += Math.floor(random() * 16).toString(16);
  return out;
}

/** `sentences` sentences of 4–12 words, capitalised and ended. */
function utterance(random: Random, vocabulary: readonly string[], sentences: number): string {
  const out: string[] = [];
  for (let s = 0; s < sentences; s++) {
    const words = Array.from({ length: int(random, 4, 12) }, () => pick(random, vocabulary));
    const first = words[0] ?? '';
    words[0] = first.charAt(0).toUpperCase() + first.slice(1);
    out.push(`${words.join(' ')}${pick(random, ENDINGS)}`);
  }
  return out.join(' ');
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Word timings spread evenly over the turn. */
function wordsFor(text: string, start: number, end: number): Word[] {
  const parts = text.split(' ');
  const step = (end - start) / parts.length;
  return parts.map((part, i) => ({
    text: part,
    start: r3(start + i * step),
    end: r3(start + (i + 1) * step),
    logprob: -0.05,
  }));
}

function makeSession(
  random: Random,
  index: number,
  language: CorpusLanguage,
  durationSec: number,
  recordedAt: number,
  withWords: boolean,
): TranscriptDoc {
  const respondents = Array.from(
    { length: int(random, 1, 4) },
    (_, i) => NAMES[(index + i) % NAMES.length],
  );
  const labels = ['Interviewer', ...respondents];
  const turns: Turn[] = [];
  const translation: Record<string, string> = {};
  let t = 0.5;
  let speaker = 0;
  while (t < durationSec) {
    const n = turns.length;
    const long = speaker !== 0 && n > 0 && n % MONOLOGUE_EVERY === 0;
    const sentences = speaker === 0 ? 1 : long ? int(random, 10, 18) : int(random, 1, 4);
    const text = utterance(random, VOCABULARY[language], sentences);
    const words = text.split(' ').length;
    const end = r3(t + words * WORD_SEC);
    const id = `t${n + 1}`;
    turns.push({
      id,
      speakerId: `speaker_${speaker}`,
      start: r3(t),
      end,
      text,
      words: withWords ? wordsFor(text, r3(t), end) : [],
    });
    if (language !== 'en') translation[id] = utterance(random, VOCABULARY.en, sentences);
    t = end + PAUSE_SEC;
    // The interviewer asks, a respondent answers; sometimes another respondent goes on.
    speaker = speaker !== 0 && random() < 0.6 ? 0 : int(random, 1, labels.length - 1);
  }

  const order = [...new Set(turns.map((turn) => turn.speakerId))];
  const speakers: Speaker[] = order.map((id) => ({
    id,
    label: labels[Number(id.slice('speaker_'.length))] ?? id,
  }));
  const fileName = `P${String(index + 1).padStart(2, '0')} ${pick(random, CITIES[language])} ${pick(random, KINDS)}.m4a`;
  const createdAt = new Date(recordedAt + durationSec * 1000 + 600_000).toISOString();
  return {
    schemaVersion: 1,
    id: `${hex(random, 8)}-${hex(random, 4)}-4${hex(random, 3)}-8${hex(random, 3)}-${hex(random, 12)}`,
    createdAt,
    source: {
      fileName,
      fileSize: Math.round(durationSec * 16_000),
      mimeType: 'audio/mp4',
      lastModified: recordedAt,
      durationSec: r3(durationSec),
    },
    request: {
      provider: 'elevenlabs',
      model: 'scribe_v2',
      languageHint: 'auto',
      numSpeakers: null,
      zeroRetention: false,
      keyterms: [],
    },
    result: {
      providerTranscriptId: `corpus-${index + 1}`,
      languageCode: LANGUAGE_CODES[language],
      languageProbability: 0.97,
      audioDurationSec: r3(durationSec),
    },
    speakers,
    turns,
    translations:
      language === 'en'
        ? {}
        : {
            en: { provider: 'claude', model: 'claude-sonnet-5-5', createdAt, texts: translation },
          },
  };
}

/** Puts each planted phrase in its session, replacing the text of one turn. */
function plant(
  docs: TranscriptDoc[],
  languages: CorpusLanguage[],
  withWords: boolean,
): PlantedPhrase[] {
  const planted: PlantedPhrase[] = [];
  PLANTS.forEach((spec, k) => {
    const docIndex = languages.map((l, i) => (l === spec.language ? i : -1)).filter((i) => i >= 0)[
      spec.nth
    ];
    const doc = docIndex === undefined ? undefined : docs[docIndex];
    if (!doc) return; // the corpus has too few sessions in this language
    const turnIndex = Math.floor((doc.turns.length * (k + 1)) / (PLANTS.length + 2));
    const turn = doc.turns[turnIndex];
    if (!turn) return;
    doc.turns[turnIndex] = {
      ...turn,
      text: spec.text,
      words: withWords ? wordsFor(spec.text, turn.start, turn.end) : [],
    };
    const translation = doc.translations.en;
    if (translation && spec.en !== null) translation.texts[turn.id] = spec.en;
    planted.push({
      phrase: spec.phrase,
      sessionId: doc.id,
      turnId: turn.id,
      start: turn.start,
      field: spec.field,
    });
  });
  return planted;
}

/** A corpus of about `hours` hours of interviews, the same for the same options. */
export function makeCorpus(options: MakeCorpusOptions): GeneratedCorpus {
  const random = prng(options.seed);
  const pool = options.languages ?? DEFAULT_LANGUAGES;
  const withWords = options.withWords ?? false;
  const docs: TranscriptDoc[] = [];
  const languages: CorpusLanguage[] = [];
  let remaining = options.hours * 3600;
  let recordedAt = FIRST_RECORDING;
  while (remaining > 0) {
    // 1–3 hours, never leaving less than an hour for the last session.
    const target = 3600 * (1 + 2 * random());
    let durationSec = target;
    if (remaining - target < 3600)
      durationSec = remaining <= 3 * 3600 ? remaining : remaining - 3600;
    const language = pick(random, pool);
    docs.push(makeSession(random, docs.length, language, durationSec, recordedAt, withWords));
    languages.push(language);
    remaining -= durationSec;
    recordedAt += int(random, 1, 3) * DAY_MS + int(random, 0, 8) * 3_600_000;
  }
  return { docs, planted: plant(docs, languages, withWords) };
}

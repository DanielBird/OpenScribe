// Hand edits to a session summary (Phase 39, DECISIONS.md D60). Each edit is a function from a summary to a new one,
// which returns the same object when nothing changes and keeps the identity of the entries it doesn't touch. Entries
// are copied with spread, so fields this build doesn't know are kept (D38). Turn ids, the research questions' wording
// and respondents' speaker ids are never changed here: they are the model's, checked when it wrote them.
import {
  NOT_DISCUSSED,
  type RespondentAttribute,
  type SessionSummary,
  type SummaryQuote,
  type SummaryTheme,
} from './summary';

/** A piece of a summary's text that is edited as one block. The overview's paragraphs are edited as a list. */
export type SummaryBlock =
  | { kind: 'title' }
  | { kind: 'synopsis' }
  | { kind: 'respondent'; index: number }
  | { kind: 'field'; respondent: number; index: number }
  | { kind: 'value'; respondent: number; index: number }
  | { kind: 'finding'; index: number }
  | { kind: 'themeName'; index: number }
  | { kind: 'themeDescription'; index: number };

/** Where an entry's quotes are: under a research question's finding, or under a theme. */
export type QuotePlace = { kind: 'question'; index: number } | { kind: 'theme'; index: number };

/**
 * Whether a theme name is one the project's other sessions already use (compared as `themeKey` does). A renamed or
 * added theme is new unless it is (A3).
 */
export type IsKnownTheme = (name: string) => boolean;

/** Text as a block keeps it: one line. Line breaks (from a paste or a drop) become spaces. */
export function cleanBlockText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/** Pasted text for an overview paragraph: one paragraph per run of text between blank lines, each on one line. */
export function splitPastedParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => cleanBlockText(p).trim())
    .filter(Boolean);
}

/** The overview's paragraphs, as the summary view shows them. */
export function overviewParagraphs(overview: string): string[] {
  return overview
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The overview made from its paragraphs: one string, paragraphs separated by a blank line. Empty ones are left out. */
export function setOverviewParagraphs(
  s: SessionSummary,
  paragraphs: readonly string[],
): SessionSummary {
  const overview = paragraphs
    .map((p) => cleanBlockText(p).trim())
    .filter(Boolean)
    .join('\n\n');
  return overview === s.overview ? s : { ...s, overview };
}

/**
 * Splits paragraph `index` at `at` (a character offset): the text after it starts a new paragraph below. The caret
 * goes to the start of the new one.
 */
export function splitParagraph(
  paragraphs: readonly string[],
  index: number,
  at: number,
): { paragraphs: string[]; caret: { index: number; offset: number } } {
  const text = paragraphs[index] ?? '';
  const next = paragraphs.slice();
  next.splice(index, 1, text.slice(0, at).trimEnd(), text.slice(at).trimStart());
  return { paragraphs: next, caret: { index: index + 1, offset: 0 } };
}

/**
 * Joins paragraph `index` to the one above it, with a space between them when neither has one. The caret goes to the
 * join. `null` for the first paragraph, which has nothing above it.
 */
export function joinParagraphs(
  paragraphs: readonly string[],
  index: number,
): { paragraphs: string[]; caret: { index: number; offset: number } } | null {
  if (index <= 0 || index >= paragraphs.length) return null;
  const above = (paragraphs[index - 1] ?? '').trimEnd();
  const below = (paragraphs[index] ?? '').trimStart();
  const joined = above && below ? `${above} ${below}` : above + below;
  const next = paragraphs.slice();
  next.splice(index - 1, 2, joined);
  return {
    paragraphs: next,
    caret: { index: index - 1, offset: above && below ? above.length + 1 : above.length },
  };
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  const next = list.slice();
  next[index] = item;
  return next;
}

/** The text a block shows, or `null` if the summary has no such block. */
export function blockText(s: SessionSummary, block: SummaryBlock): string | null {
  switch (block.kind) {
    case 'title':
      return s.title;
    case 'synopsis':
      return s.synopsis;
    case 'respondent':
      return s.respondents[block.index]?.label ?? null;
    case 'field':
      return s.respondents[block.respondent]?.attributes[block.index]?.field ?? null;
    case 'value':
      return s.respondents[block.respondent]?.attributes[block.index]?.value ?? null;
    case 'finding':
      return s.researchQuestions[block.index]?.finding ?? null;
    case 'themeName':
      return s.themes[block.index]?.name ?? null;
    case 'themeDescription':
      return s.themes[block.index]?.description ?? null;
  }
}

function setAttribute(
  s: SessionSummary,
  respondent: number,
  index: number,
  patch: Partial<RespondentAttribute>,
): SessionSummary {
  const r = s.respondents[respondent];
  const a = r?.attributes[index];
  if (!r || !a) return s;
  const attributes = replaceAt(r.attributes, index, { ...a, ...patch });
  return { ...s, respondents: replaceAt(s.respondents, respondent, { ...r, attributes }) };
}

function setTheme(s: SessionSummary, index: number, patch: Partial<SummaryTheme>): SessionSummary {
  const t = s.themes[index];
  if (!t) return s;
  return { ...s, themes: replaceAt(s.themes, index, { ...t, ...patch }) };
}

/**
 * Sets a block's text, made one line (`cleanBlockText`), but not trimmed: the block is trimmed when it is left
 * (`leaveBlock`). A theme that is renamed is new unless `isKnownTheme` knows its name.
 */
export function setBlockText(
  s: SessionSummary,
  block: SummaryBlock,
  text: string,
  isKnownTheme: IsKnownTheme,
): SessionSummary {
  const value = cleanBlockText(text);
  if (blockText(s, block) === value || blockText(s, block) === null) return s;
  switch (block.kind) {
    case 'title':
      return { ...s, title: value };
    case 'synopsis':
      return { ...s, synopsis: value };
    case 'respondent': {
      const r = s.respondents[block.index];
      return r
        ? { ...s, respondents: replaceAt(s.respondents, block.index, { ...r, label: value }) }
        : s;
    }
    case 'field':
      return setAttribute(s, block.respondent, block.index, { field: value });
    case 'value':
      return setAttribute(s, block.respondent, block.index, { value });
    case 'finding': {
      const q = s.researchQuestions[block.index];
      return q
        ? {
            ...s,
            researchQuestions: replaceAt(s.researchQuestions, block.index, {
              ...q,
              finding: value,
            }),
          }
        : s;
    }
    case 'themeName':
      return setTheme(s, block.index, { name: value, isNew: !isKnownTheme(value) });
    case 'themeDescription':
      return setTheme(s, block.index, { description: value });
  }
}

/**
 * What a block's text becomes when it is left (decision 7): trimmed; an empty title gets back `textOnFocus` (the
 * sessions list needs a title); an empty finding becomes `NOT_DISCUSSED`; an empty theme name gets back
 * `textOnFocus` while the theme has a description. An empty synopsis, label or detail is allowed.
 */
export function leaveBlock(
  s: SessionSummary,
  block: SummaryBlock,
  textOnFocus: string,
  isKnownTheme: IsKnownTheme,
): SessionSummary {
  const text = blockText(s, block);
  if (text === null) return s;
  let next = text.trim();
  if (next === '') {
    if (block.kind === 'title') next = textOnFocus.trim();
    else if (block.kind === 'finding') next = NOT_DISCUSSED;
    else if (
      block.kind === 'themeName' &&
      (s.themes[block.index]?.description.trim() ?? '') !== ''
    ) {
      next = textOnFocus.trim();
    }
  }
  return setBlockText(s, block, next, isKnownTheme);
}

/** Adds an empty theme after theme `after` (-1 for the first). It is new until it is named. */
export function addTheme(s: SessionSummary, after: number): SessionSummary {
  const theme: SummaryTheme = { name: '', description: '', turnIds: [], isNew: true, quotes: [] };
  const themes = s.themes.slice();
  themes.splice(Math.max(0, Math.min(after + 1, themes.length)), 0, theme);
  return { ...s, themes };
}

/** Removes a theme with its quotes. */
export function removeTheme(s: SessionSummary, index: number): SessionSummary {
  if (!s.themes[index]) return s;
  return { ...s, themes: s.themes.filter((_, i) => i !== index) };
}

/** Whether a theme has nothing in it: no name, no description and no quotes. The keyboard removes only these. */
export function isEmptyTheme(theme: SummaryTheme): boolean {
  return theme.name.trim() === '' && theme.description.trim() === '' && theme.quotes.length === 0;
}

/** Adds an empty detail row under detail `after` of a respondent (-1 for the first). */
export function addAttribute(s: SessionSummary, respondent: number, after: number): SessionSummary {
  const r = s.respondents[respondent];
  if (!r) return s;
  const attributes = r.attributes.slice();
  attributes.splice(Math.max(0, Math.min(after + 1, attributes.length)), 0, {
    field: '',
    value: '',
    turnIds: [],
  });
  return { ...s, respondents: replaceAt(s.respondents, respondent, { ...r, attributes }) };
}

/** Removes a respondent's detail row. */
export function removeAttribute(
  s: SessionSummary,
  respondent: number,
  index: number,
): SessionSummary {
  const r = s.respondents[respondent];
  if (!r?.attributes[index]) return s;
  const attributes = r.attributes.filter((_, i) => i !== index);
  return { ...s, respondents: replaceAt(s.respondents, respondent, { ...r, attributes }) };
}

/** Whether a detail row has nothing in it. */
export function isEmptyAttribute(a: RespondentAttribute): boolean {
  return a.field.trim() === '' && a.value.trim() === '';
}

/** An entry's quotes, or `null` if there is no such entry. */
export function quotesAt(s: SessionSummary, place: QuotePlace): readonly SummaryQuote[] | null {
  return (
    (place.kind === 'question' ? s.researchQuestions[place.index] : s.themes[place.index])
      ?.quotes ?? null
  );
}

function setQuotes(s: SessionSummary, place: QuotePlace, quotes: SummaryQuote[]): SessionSummary {
  if (place.kind === 'question') {
    const q = s.researchQuestions[place.index];
    return q
      ? { ...s, researchQuestions: replaceAt(s.researchQuestions, place.index, { ...q, quotes }) }
      : s;
  }
  return setTheme(s, place.index, { quotes });
}

/** Adds a quote at the end of an entry's quotes. The entry's `turnIds` don't change. */
export function addQuote(
  s: SessionSummary,
  place: QuotePlace,
  quote: SummaryQuote,
): SessionSummary {
  const quotes = quotesAt(s, place);
  return quotes ? setQuotes(s, place, [...quotes, quote]) : s;
}

/** Removes an entry's quote. The entry's `turnIds` don't change. */
export function removeQuote(
  s: SessionSummary,
  place: QuotePlace,
  quoteIndex: number,
): SessionSummary {
  const quotes = quotesAt(s, place);
  if (!quotes?.[quoteIndex]) return s;
  return setQuotes(
    s,
    place,
    quotes.filter((_, i) => i !== quoteIndex),
  );
}

/**
 * The summary as editing leaves it (**Done**): every block trimmed, and the themes and detail rows with nothing in
 * them removed, so the file has no empty entries.
 */
export function tidySummary(s: SessionSummary): SessionSummary {
  const trim = (text: string) => text.trim();
  let next = s;
  if (s.title.trim() !== s.title || s.synopsis.trim() !== s.synopsis) {
    next = { ...next, title: trim(s.title), synopsis: trim(s.synopsis) };
  }
  const themes = next.themes.filter((t) => !isEmptyTheme(t));
  if (themes.length !== next.themes.length) next = { ...next, themes };
  if (next.respondents.some((r) => r.attributes.some(isEmptyAttribute))) {
    next = {
      ...next,
      respondents: next.respondents.map((r) =>
        r.attributes.some(isEmptyAttribute)
          ? { ...r, attributes: r.attributes.filter((a) => !isEmptyAttribute(a)) }
          : r,
      ),
    };
  }
  return next;
}

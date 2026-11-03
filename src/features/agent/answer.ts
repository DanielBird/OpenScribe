// An answer from the agent, as blocks the chat renders (PROJECTS.md §5.5). A small Markdown subset: paragraphs,
// headings, one-level lists, bold and italic. Everything else stays plain text: nothing here ever becomes HTML,
// because the CSP allows inline script. Quotes are checked against the English text of their turn (T13).
import type { CitationParts } from '../../domain/corpus/citation';
import type { QuoteCheck } from '../../domain/corpus/quoteCheck';
import { checkQuote } from '../../domain/corpus/quoteCheck';
import { parseRef } from '../../domain/corpus/sessionKeys';
import { englishText, isTranslatedSession } from '../../domain/corpus/sessionText';
import { oneLine } from '../../domain/text';
import type { CorpusReader } from './corpus';
import { speakerLabel } from './format';

export type Inline = { kind: 'text' | 'bold' | 'italic'; text: string };

export type AnswerBlock =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'heading'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | {
      kind: 'quote';
      ref: string;
      sessionId: string | null;
      modelText: string;
      check: QuoteCheck;
      citation: CitationParts | null;
    };

const QUOTE = /<quote\s+ref\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>([\s\S]*?)<\/quote\s*>/gi;
const OPENING = '<quote';

/**
 * While streaming, the text up to an unfinished quote tag: a `<quote …` that hasn't closed yet, or the start of
 * one at the very end (`<quo`). It shows once it closes.
 */
function settledText(text: string): string {
  const lower = text.toLowerCase();
  let searchFrom = 0;
  for (const match of text.matchAll(QUOTE)) searchFrom = match.index + match[0].length;
  const open = lower.indexOf(OPENING, searchFrom);
  if (open >= 0) return text.slice(0, open);
  const lastLt = lower.lastIndexOf('<');
  if (lastLt >= searchFrom && OPENING.startsWith(lower.slice(lastLt))) return text.slice(0, lastLt);
  return text;
}

// --- inline -------------------------------------------------------------------------------------------------

const INLINE =
  /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*|(?<![\p{L}\p{N}_])_(?=\S)([\s\S]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu;

function pushInline(inlines: Inline[], kind: Inline['kind'], text: string): void {
  if (!text) return;
  const last = inlines[inlines.length - 1];
  if (last && last.kind === kind) last.text += text;
  else inlines.push({ kind, text });
}

/** `**bold**`, `*italic*` and `_italic_`; any other character, `<` included, is text. */
export function parseInlines(text: string): Inline[] {
  const inlines: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    pushInline(inlines, 'text', text.slice(at, match.index));
    if (match[1] !== undefined) pushInline(inlines, 'bold', match[1]);
    else pushInline(inlines, 'italic', match[2] ?? match[3] ?? '');
    at = match.index + match[0].length;
  }
  pushInline(inlines, 'text', text.slice(at));
  return inlines;
}

// --- blocks -------------------------------------------------------------------------------------------------

const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

function textBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const endParagraph = () => {
    const joined = paragraph.join(' ').trim();
    if (joined) blocks.push({ kind: 'paragraph', inlines: parseInlines(joined) });
    paragraph = [];
  };
  const endList = () => {
    if (list)
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseInlines) });
    list = null;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      endParagraph();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      if (heading[1]) blocks.push({ kind: 'heading', inlines: parseInlines(heading[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      endParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) endList();
      list ??= { ordered, items: [] };
      list.items.push((item[1] ?? '').trim());
      continue;
    }
    if (list && /^\s/.test(line)) {
      // An indented line goes on with the last item.
      const items: string[] = list.items;
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`;
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}

// --- quotes -------------------------------------------------------------------------------------------------

const NOT_FOUND: QuoteCheck = { status: 'not_found' };

function quoteBlock(ref: string, modelText: string, corpus: CorpusReader): AnswerBlock {
  const parsed = parseRef(ref);
  const session = parsed ? corpus.byKey(parsed.sessionKey) : undefined;
  const base = {
    kind: 'quote' as const,
    ref: ref.trim(),
    modelText,
    sessionId: session?.text.sessionId ?? null,
  };
  const turn = session?.text.turns.find((t) => t.id === parsed?.turnId);
  const english = session && turn ? englishText(session.text, turn) : null;
  if (!session || !turn || english === null) return { ...base, check: NOT_FOUND, citation: null };

  const check = checkQuote(english, modelText);
  if (check.status !== 'verified') return { ...base, check, citation: null };
  return {
    ...base,
    check,
    citation: {
      text: check.sourceText,
      speakerLabel: speakerLabel(session.text, turn.speakerId),
      start: turn.start,
      sessionTitle: oneLine(session.title),
      translatedFrom: isTranslatedSession(session.text) ? session.text.languageCode : null,
    },
  };
}

/**
 * The answer as blocks. A quote tag is a block of its own, even in the middle of a paragraph. With
 * `streaming`, an unfinished quote tag at the end is held back until it closes.
 */
export function parseAnswer(
  text: string,
  corpus: CorpusReader,
  opts: { streaming?: boolean } = {},
): AnswerBlock[] {
  const source = opts.streaming ? settledText(text) : text;
  const blocks: AnswerBlock[] = [];
  let at = 0;
  for (const match of source.matchAll(QUOTE)) {
    blocks.push(...textBlocks(source.slice(at, match.index)));
    blocks.push(quoteBlock(match[1] ?? match[2] ?? '', (match[3] ?? '').trim(), corpus));
    at = match.index + match[0].length;
  }
  blocks.push(...textBlocks(source.slice(at)));
  return blocks;
}

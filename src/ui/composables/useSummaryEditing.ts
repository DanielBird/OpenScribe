// A session summary edited in place, as a document (Phase 39, DECISIONS.md D60). Each piece of text the user can
// change is a `contenteditable="plaintext-only"` block on the element that shows it, named by `data-block`; this
// composable turns what happens in those blocks (typing, Enter, Backspace, paste, leaving one) into the domain's edits
// (`domain/summaryEdit.ts`) and hands them to the edit store, which saves them. The text is never rendered with
// `v-html`: it goes in and comes out as `textContent` (`vBlockText`).
import { computed, nextTick, ref, watch, type Directive, type Ref } from 'vue';
import { findQuoteTurn } from '../../domain/corpus/quoteCheck';
import type { SessionText } from '../../domain/corpus/sessionText';
import type { SessionSummary } from '../../domain/summary';
import {
  addAttribute,
  addQuote,
  addTheme,
  blockText,
  cleanBlockText,
  isEmptyAttribute,
  isEmptyTheme,
  joinParagraphs,
  leaveBlock,
  overviewParagraphs,
  removeAttribute,
  removeQuote,
  removeTheme,
  setBlockText,
  setOverviewParagraphs,
  splitParagraph,
  splitPastedParagraphs,
  type QuotePlace,
  type SummaryBlock,
} from '../../domain/summaryEdit';
import { useSummaryEditStore } from '../../stores/summaryEdit';
import { caretOffset, useBlockNavigation, type CaretGeometry } from './useBlockNavigation';

/** A block as the editor knows it: one of the summary's, an overview paragraph, or a quote being added. */
export type EditorBlock = SummaryBlock | { kind: 'overview'; index: number } | { kind: 'quote' };

export function blockId(block: EditorBlock): string {
  switch (block.kind) {
    case 'title':
    case 'synopsis':
    case 'quote':
      return block.kind;
    case 'field':
    case 'value':
      return `${block.kind}-${block.respondent}-${block.index}`;
    default:
      return `${block.kind}-${block.index}`;
  }
}

export function parseBlockId(id: string | undefined): EditorBlock | null {
  if (!id) return null;
  const [kind, a, b] = id.split('-');
  const n = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
  switch (kind) {
    case 'title':
    case 'synopsis':
    case 'quote':
      return { kind };
    case 'field':
    case 'value': {
      const respondent = n(a);
      const index = n(b);
      return respondent === null || index === null ? null : { kind, respondent, index };
    }
    case 'overview':
    case 'respondent':
    case 'finding':
    case 'themeName':
    case 'themeDescription': {
      const index = n(a);
      return index === null ? null : { kind, index };
    }
    default:
      return null;
  }
}

/** A block's text and a version: the text is set while the block doesn't have the caret, or when the version moves. */
export interface BlockTextValue {
  text: string;
  version: string;
}

const versions = new WeakMap<HTMLElement, string>();

/**
 * Sets an element's text as `textContent`, never as HTML. While the element is being typed in, the DOM is the
 * truth and the text isn't set (the caret would jump), unless the version moved: the block was replaced from outside
 * (**Reload**) or the blocks around it changed (Enter, Backspace).
 */
export const vBlockText: Directive<HTMLElement, BlockTextValue> = {
  mounted(el, { value }) {
    el.textContent = value.text;
    versions.set(el, value.version);
  },
  updated(el, { value }) {
    const moved = versions.get(el) !== value.version;
    versions.set(el, value.version);
    const typing = document.activeElement === el && el.hasAttribute('contenteditable');
    if (el.textContent !== value.text && (moved || !typing)) el.textContent = value.text;
  },
};

/** What makes an element an editable block. */
export interface BlockAttrs {
  contenteditable?: 'plaintext-only';
  role?: 'textbox';
  'aria-label'?: string;
  'aria-multiline'?: 'true';
  spellcheck?: boolean;
  'data-block'?: string;
}

interface Paragraph {
  id: number;
  text: string;
}

/** Inserts plain text at the caret. `insertText` keeps Ctrl+Z working, and fires `input` itself. */
function insertText(el: HTMLElement, text: string): void {
  const inserted =
    typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (inserted) return;
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useSummaryEditing(options: {
  sessionId: () => string;
  text: () => SessionText | null;
  container: Readonly<Ref<HTMLElement | null>>;
  /** Where Escape in a block takes the focus: **Done**. */
  done: Readonly<Ref<HTMLElement | null>>;
  geometry?: CaretGeometry;
}) {
  const edit = useSummaryEditStore();
  const nav = useBlockNavigation(options.container, options.geometry);

  const editing = computed(() => edit.sessionId === options.sessionId() && edit.draft !== null);
  /** Bumped when blocks are added, removed, split or joined, so each block shows its text again. */
  const structure = ref(0);
  const version = computed(() => `${edit.generation}:${structure.value}`);

  // The overview's paragraphs while editing, each with an id so an emptied one can go without moving the others.
  // The file keeps them as one string (`setOverviewParagraphs`), which has no empty ones.
  const paragraphs = ref<Paragraph[]>([]);
  let nextParagraph = 0;
  const toParagraphs = (texts: readonly string[]) =>
    texts.map((text) => ({ id: nextParagraph++, text }));
  watch(
    () => [editing.value, edit.generation] as const,
    ([on]) => {
      if (!on || !edit.draft) return;
      const texts = overviewParagraphs(edit.draft.overview);
      paragraphs.value = toParagraphs(texts.length > 0 ? texts : ['']);
    },
    { immediate: true },
  );

  /** The entry a quote is being added to, while its block is open. */
  const pendingQuote = ref<QuotePlace | null>(null);

  /** A block's text when it got the caret: an emptied title goes back to it. */
  let textOnFocus = '';

  const draft = (): SessionSummary | null => edit.draft;

  function change(next: SessionSummary): void {
    edit.change(next);
  }

  function setParagraphs(next: Paragraph[]): void {
    paragraphs.value = next;
    const current = draft();
    if (current)
      change(
        setOverviewParagraphs(
          current,
          next.map((p) => p.text),
        ),
      );
  }

  /** After the blocks change: show every block's text again, then put the caret in `id`. */
  async function restructure(id: string | null, at: number | 'start' | 'end'): Promise<void> {
    structure.value++;
    await nextTick();
    if (id === null || !nav.focusById(id, at)) options.done.value?.focus();
  }

  const blockOf = (el: HTMLElement) => parseBlockId(el.dataset.block);
  const isKnownTheme = (name: string) => edit.isKnownTheme(name);

  // --- Events on a block -------------------------------------------------------------------------

  function onFocus(event: FocusEvent): void {
    textOnFocus = (event.currentTarget as HTMLElement).textContent ?? '';
  }

  function onInput(event: Event): void {
    const el = event.currentTarget as HTMLElement;
    const block = blockOf(el);
    const current = draft();
    if (!block || !current) return;
    const text = el.textContent ?? '';
    if (block.kind === 'quote') return;
    if (block.kind === 'overview') {
      setParagraphs(paragraphs.value.map((p, i) => (i === block.index ? { ...p, text } : p)));
      return;
    }
    change(setBlockText(current, block, text, isKnownTheme));
  }

  function onBlur(event: FocusEvent): void {
    const el = event.currentTarget as HTMLElement;
    const block = blockOf(el);
    const current = draft();
    if (!block || !current) return;
    if (block.kind === 'quote') {
      commitQuote(el);
      return;
    }
    if (block.kind === 'overview') {
      const list = paragraphs.value;
      const here = list[block.index];
      if (!here) return;
      const text = cleanBlockText(here.text).trim();
      if (text === '' && list.length > 1) {
        setParagraphs(list.filter((p) => p !== here));
      } else {
        setParagraphs(list.map((p) => (p === here ? { ...p, text } : p)));
        if (el.textContent !== text) el.textContent = text;
      }
      return;
    }
    const next = leaveBlock(current, block, textOnFocus, isKnownTheme);
    change(next);
    const text = blockText(next, block);
    if (text !== null && el.textContent !== text) el.textContent = text;
  }

  function onPaste(event: ClipboardEvent): void {
    const el = event.currentTarget as HTMLElement;
    const block = blockOf(el);
    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    if (!block) return;
    const pieces = splitPastedParagraphs(pasted);
    if (block.kind === 'overview' && pieces.length > 1) {
      void pasteParagraphs(el, block.index, pieces);
      return;
    }
    insertText(el, cleanBlockText(pasted));
  }

  /** Text pasted into an overview paragraph splits into paragraphs at its blank lines. */
  async function pasteParagraphs(el: HTMLElement, index: number, pieces: string[]): Promise<void> {
    const list = paragraphs.value;
    const here = list[index];
    if (!here) return;
    const text = el.textContent ?? '';
    const at = caretOffset(el) ?? text.length;
    const first = text.slice(0, at) + (pieces[0] ?? '');
    const last = pieces[pieces.length - 1] ?? '';
    const middle = pieces.slice(1, -1);
    const added = toParagraphs([...middle, last + text.slice(at)]);
    const next = list.slice();
    next.splice(index, 1, { ...here, text: first }, ...added);
    setParagraphs(next);
    await restructure(blockId({ kind: 'overview', index: index + pieces.length - 1 }), last.length);
  }

  // --- Keys ----------------------------------------------------------------------------------------

  /** On the editor's root: Escape, the arrow keys, Enter, Backspace and Delete in a block. */
  function onKeydown(event: KeyboardEvent): void {
    if (!editing.value || event.isComposing || event.defaultPrevented) return;
    const target = event.target;
    const el = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-block]') : null;
    const block = el ? blockOf(el) : null;
    if (!el || !block) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        el.blur();
        options.done.value?.focus();
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        if (nav.onArrow(event, el)) event.preventDefault();
        return;
      case 'Enter':
        event.preventDefault();
        void onEnter(el, block);
        return;
      case 'Backspace':
        if (onBackspace(el, block)) event.preventDefault();
        return;
      case 'Delete':
        if (onDelete(el, block)) event.preventDefault();
        return;
    }
  }

  const atEnd = (el: HTMLElement) => caretOffset(el) === (el.textContent?.length ?? 0);

  /**
   * Enter: splits an overview paragraph; at the end of a theme's description adds a theme, and at the end of a
   * respondent's detail adds a detail row; elsewhere goes on to the next block. Text never gets a line break.
   */
  async function onEnter(el: HTMLElement, block: EditorBlock): Promise<void> {
    const current = draft();
    if (!current) return;
    if (block.kind === 'overview') {
      const list = paragraphs.value;
      const here = list[block.index];
      if (!here) return;
      const text = el.textContent ?? '';
      const split = splitParagraph(
        list.map((p) => (p === here ? text : p.text)),
        block.index,
        caretOffset(el) ?? text.length,
      );
      const next = list.slice();
      next.splice(
        block.index,
        1,
        { ...here, text: split.paragraphs[block.index] ?? '' },
        ...toParagraphs([split.paragraphs[block.index + 1] ?? '']),
      );
      setParagraphs(next);
      await restructure(blockId({ kind: 'overview', index: block.index + 1 }), 'start');
      return;
    }
    if (block.kind === 'themeDescription' && atEnd(el)) {
      change(addTheme(current, block.index));
      await restructure(blockId({ kind: 'themeName', index: block.index + 1 }), 'start');
      return;
    }
    if (block.kind === 'value' && atEnd(el)) {
      change(addAttribute(current, block.respondent, block.index));
      const row = { kind: 'field', respondent: block.respondent, index: block.index + 1 } as const;
      await restructure(blockId(row), 'start');
      return;
    }
    if (
      block.kind === 'respondent' &&
      atEnd(el) &&
      current.respondents[block.index]?.attributes.length === 0
    ) {
      change(addAttribute(current, block.index, -1));
      await restructure(blockId({ kind: 'field', respondent: block.index, index: 0 }), 'start');
      return;
    }
    if (!nav.moveFrom(el, 1)) el.blur();
  }

  /**
   * Backspace at a block's start: joins an overview paragraph to the one above; removes a theme or a detail row that
   * has nothing in it; otherwise goes to the end of the block above. True when it did something.
   */
  function onBackspace(el: HTMLElement, block: EditorBlock): boolean {
    const current = draft();
    if (!current || caretOffset(el) !== 0) return false;
    if (block.kind === 'overview' && block.index > 0) {
      void joinOverview(block.index);
      return true;
    }
    if (block.kind === 'themeName' || block.kind === 'themeDescription') {
      const theme = current.themes[block.index];
      if (theme && isEmptyTheme(theme)) {
        void removeAndFocusAbove(el, removeTheme(current, block.index));
        return true;
      }
    }
    if (block.kind === 'field' || block.kind === 'value') {
      const row = current.respondents[block.respondent]?.attributes[block.index];
      if (row && isEmptyAttribute(row)) {
        void removeAndFocusAbove(el, removeAttribute(current, block.respondent, block.index));
        return true;
      }
    }
    return nav.moveFrom(el, -1);
  }

  /** Delete at the end of an overview paragraph joins the next one to it. */
  function onDelete(el: HTMLElement, block: EditorBlock): boolean {
    if (block.kind !== 'overview' || !atEnd(el) || block.index >= paragraphs.value.length - 1) {
      return false;
    }
    void joinOverview(block.index + 1);
    return true;
  }

  async function joinOverview(index: number): Promise<void> {
    const list = paragraphs.value;
    const joined = joinParagraphs(
      list.map((p) => p.text),
      index,
    );
    const above = list[index - 1];
    if (!joined || !above) return;
    const next = list.slice();
    next.splice(index - 1, 2, { ...above, text: joined.paragraphs[index - 1] ?? '' });
    setParagraphs(next);
    await restructure(blockId({ kind: 'overview', index: index - 1 }), joined.caret.offset);
  }

  async function removeAndFocusAbove(el: HTMLElement, next: SessionSummary): Promise<void> {
    const above = nav.neighbour(el, -1)?.dataset.block ?? null;
    change(next);
    await restructure(above, 'end');
  }

  // --- Themes and quotes ---------------------------------------------------------------------------

  /** **Remove theme**: with its quotes, and no undo. The caret goes to the next theme, or the one above. */
  async function onRemoveTheme(index: number): Promise<void> {
    const current = draft();
    if (!current) return;
    change(removeTheme(current, index));
    const left = current.themes.length - 1;
    const id =
      left === 0
        ? null
        : index < left
          ? blockId({ kind: 'themeName', index })
          : blockId({ kind: 'themeDescription', index: index - 1 });
    await restructure(id, index < left ? 'start' : 'end');
  }

  /** **Add theme**, at the end. */
  async function onAddTheme(): Promise<void> {
    const current = draft();
    if (!current) return;
    change(addTheme(current, current.themes.length - 1));
    await restructure(blockId({ kind: 'themeName', index: current.themes.length }), 'start');
  }

  /** **Add quote**: an empty quote block under the entry, with the caret in it. */
  async function onAddQuote(place: QuotePlace): Promise<void> {
    pendingQuote.value = place;
    await nextTick();
    nav.focusById('quote', 'start');
  }

  /**
   * A quote block that's left: its words are looked for in the session, turn by turn, and the quote takes the first
   * turn that has them, in the transcript's own words. Words that aren't found are kept, with no turn, and the card
   * marks them. An empty block is dropped.
   */
  function commitQuote(el: HTMLElement): void {
    const place = pendingQuote.value;
    pendingQuote.value = null;
    const current = draft();
    const words = cleanBlockText(el.textContent ?? '').trim();
    if (!place || !current || words === '') return;
    const session = options.text();
    const found = session ? findQuoteTurn(session, words) : null;
    change(addQuote(current, place, found ?? { turnId: '', text: words }));
  }

  /** **Remove quote**: the caret goes back to the entry's text. */
  async function onRemoveQuote(place: QuotePlace, index: number): Promise<void> {
    const current = draft();
    if (!current) return;
    change(removeQuote(current, place, index));
    const block: EditorBlock =
      place.kind === 'question'
        ? { kind: 'finding', index: place.index }
        : { kind: 'themeDescription', index: place.index };
    await restructure(blockId(block), 'end');
  }

  // --- The template's side -------------------------------------------------------------------------

  /** A block's attributes while editing; nothing while reading. */
  function blockAttrs(block: EditorBlock, label: string, multiline = false): BlockAttrs {
    if (!editing.value) return {};
    return {
      contenteditable: 'plaintext-only',
      role: 'textbox',
      'aria-label': label,
      'aria-multiline': multiline ? 'true' : undefined,
      spellcheck: true,
      'data-block': blockId(block),
    };
  }

  const blockEvents = computed(() =>
    editing.value ? { focus: onFocus, input: onInput, blur: onBlur, paste: onPaste } : {},
  );

  return {
    editing,
    version,
    paragraphs,
    pendingQuote,
    blockAttrs,
    blockEvents,
    onKeydown,
    onAddTheme,
    onRemoveTheme,
    onAddQuote,
    onRemoveQuote,
  };
}

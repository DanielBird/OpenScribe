// The caret in a document made of editable blocks (Phase 39's summary): each block is a `[data-block]` element with
// `contenteditable`, and the arrow keys cross from one to the next in reading order, as in one Word page. ↑ on a
// block's first line goes to the end of the block above, ↓ on its last line to the start of the block below; ← at
// the very start and → at the very end do the same. Anything else (Shift or Ctrl with an arrow, a selection) is the
// browser's own.
import type { Ref } from 'vue';

/** Where the caret is within a block's lines. A stand-in in tests, which have no layout. */
export interface CaretGeometry {
  onFirstLine(el: HTMLElement): boolean;
  onLastLine(el: HTMLElement): boolean;
}

/** The collapsed caret's rect, or `null` (no selection, or none the browser can measure, as in an empty block). */
function caretRect(): DOMRect | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  return rects.length > 0 ? (rects[0] ?? null) : null;
}

/** The line boxes of a block's text. */
function lineBoxes(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((r) => r.height > 0);
}

/** The browser's layout: the caret's rect against the first and last of the block's line boxes. */
export const domGeometry: CaretGeometry = {
  onFirstLine(el) {
    const caret = caretRect();
    const boxes = lineBoxes(el);
    if (!caret || boxes.length === 0) return true;
    const first = Math.min(...boxes.map((b) => b.bottom));
    return (caret.top + caret.bottom) / 2 < first;
  },
  onLastLine(el) {
    const caret = caretRect();
    const boxes = lineBoxes(el);
    if (!caret || boxes.length === 0) return true;
    const last = Math.max(...boxes.map((b) => b.top));
    return (caret.top + caret.bottom) / 2 > last;
  },
};

/** The caret's character offset in a block, or `null` when there's a selection or the caret is elsewhere. */
export function caretOffset(el: HTMLElement): number | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const node = selection.focusNode;
  if (!node || !el.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(node, selection.focusOffset);
  return range.toString().length;
}

/** Puts the caret in a block at a character offset, or at its start or end. */
export function placeCaret(el: HTMLElement, at: number | 'start' | 'end'): void {
  const selection = document.getSelection();
  if (!selection) return;
  const length = el.textContent?.length ?? 0;
  let offset = at === 'start' ? 0 : at === 'end' ? length : Math.max(0, Math.min(at, length));
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.length ?? 0;
    if (offset <= text) {
      selection.collapse(node, offset);
      return;
    }
    offset -= text;
  }
  selection.collapse(el, el.childNodes.length > 0 && at !== 'start' ? el.childNodes.length : 0);
}

export function useBlockNavigation(
  container: Readonly<Ref<HTMLElement | null>>,
  geometry: CaretGeometry = domGeometry,
) {
  /** The editable blocks, in reading order. Only editable blocks have `data-block`. */
  function blocks(): HTMLElement[] {
    const root = container.value;
    return root ? [...root.querySelectorAll<HTMLElement>('[data-block]')] : [];
  }

  function neighbour(el: HTMLElement, step: -1 | 1): HTMLElement | null {
    const list = blocks();
    const at = list.indexOf(el);
    return at === -1 ? null : (list[at + step] ?? null);
  }

  function focusBlock(el: HTMLElement, at: number | 'start' | 'end'): void {
    el.focus();
    placeCaret(el, at);
  }

  /** Focuses the block with this `data-block` id. False if there's none. */
  function focusById(id: string, at: number | 'start' | 'end'): boolean {
    const el = blocks().find((b) => b.dataset.block === id);
    if (!el) return false;
    focusBlock(el, at);
    return true;
  }

  /** Goes to the block before (end) or after (start). False at the first or last block. */
  function moveFrom(el: HTMLElement, step: -1 | 1): boolean {
    const next = neighbour(el, step);
    if (!next) return false;
    focusBlock(next, step < 0 ? 'end' : 'start');
    return true;
  }

  /** An arrow key in a block: true when it crossed to another block (the caller prevents the default). */
  function onArrow(event: KeyboardEvent, el: HTMLElement): boolean {
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
    const offset = caretOffset(el);
    if (offset === null) return false;
    const length = el.textContent?.length ?? 0;
    switch (event.key) {
      case 'ArrowUp':
        return geometry.onFirstLine(el) && moveFrom(el, -1);
      case 'ArrowDown':
        return geometry.onLastLine(el) && moveFrom(el, 1);
      case 'ArrowLeft':
        return offset === 0 && moveFrom(el, -1);
      case 'ArrowRight':
        return offset === length && moveFrom(el, 1);
      default:
        return false;
    }
  }

  return { blocks, neighbour, focusBlock, focusById, moveFrom, onArrow };
}

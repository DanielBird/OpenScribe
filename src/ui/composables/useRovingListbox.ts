import { computed, nextTick, ref, type Ref } from 'vue';

/**
 * One Tab stop for a listbox (the sessions and the chats in Analyse): the arrow keys, Home and End move between the
 * options, Enter or Space selects. A list of hundreds of buttons would be hundreds of Tab stops. Each option carries
 * its id in `data-item-id`.
 */
export function useRovingListbox(opts: {
  ids: () => readonly string[];
  selected: () => string | null;
  list: Readonly<Ref<HTMLElement | null>>;
  select: (id: string) => void;
}) {
  /** The option that has the Tab stop: the one last focused, else the selected one, else the first. */
  const focusId = ref<string | null>(null);
  const tabStop = computed(() => {
    const ids = opts.ids();
    for (const candidate of [focusId.value, opts.selected()]) {
      if (candidate && ids.includes(candidate)) return candidate;
    }
    return ids[0] ?? null;
  });

  async function focusItem(id: string): Promise<void> {
    focusId.value = id;
    await nextTick();
    opts.list.value?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)?.focus();
  }

  function moveTo(index: number): void {
    const ids = opts.ids();
    const id = ids[Math.max(0, Math.min(index, ids.length - 1))];
    if (id !== undefined) void focusItem(id);
  }

  function onKeydown(event: KeyboardEvent, index: number, id: string): void {
    switch (event.key) {
      case 'ArrowDown':
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        moveTo(index - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(opts.ids().length - 1);
        break;
      case 'Enter':
      case ' ':
        focusId.value = id;
        opts.select(id);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return { focusId, tabStop, focusItem, onKeydown };
}

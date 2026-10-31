import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlossaryStore } from '../../stores/glossary';
import GlossaryEditor from './GlossaryEditor.vue';

const STORAGE_KEY = 'describe.v1.glossary';
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;

describe('GlossaryEditor', () => {
  let wrapper: VueWrapper | null = null;

  /** Mounts the editor with `terms` already saved, as after a reload. */
  function mountEditor(terms: string[] = []) {
    if (terms.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(terms));
    wrapper = mount(GlossaryEditor, { attachTo: document.body });
    return wrapper;
  }

  const addInput = () => wrapper!.get<HTMLTextAreaElement>('textarea.composer-input');
  const editInput = () => wrapper!.find<HTMLInputElement>('input.edit-input');
  const statusRegion = () => wrapper!.get('[role="status"]');
  const status = () => statusRegion().text();
  const chips = () => wrapper!.findAll('li.chip');
  const rowTerms = () => wrapper!.findAll('li .chip-term').map((t) => t.text());
  const byLabel = (label: string) => wrapper!.get(`[aria-label="${label}"]`);
  const button = (name: string) =>
    wrapper!.findAll('button').find((b) => b.text() === name && !b.attributes('aria-label'));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  it('shows the empty state when there are no terms', () => {
    mountEditor();
    expect(wrapper!.text()).toContain(
      'A glossary is optional, but it can help the transcription spell product names and jargon correctly.',
    );
    expect(wrapper!.find('ul').exists()).toBe(false);
    expect(button('Copy list')).toBeUndefined();
    expect(button('Clear all')).toBeUndefined();
  });

  it('labels the textarea for screen readers and shows the placeholder', () => {
    mountEditor();
    const label = wrapper!.get(`label[for="${addInput().attributes('id')}"]`);
    expect(label.text()).toBe('Add terms');
    expect(label.classes()).toContain('visually-hidden');
    expect(addInput().attributes('placeholder')).toBe(
      'Add terms, one per line or separated by commas',
    );
    expect(addInput().attributes('aria-keyshortcuts')).toBe('Control+Enter');
  });

  describe('adding', () => {
    it('adds pasted terms, reports duplicates and clears the textarea', async () => {
      mountEditor();
      await addInput().setValue('Oticon\nPhilips; hearing aid, Hörgerät\n\n oticon ');
      await button('Add')!.trigger('click');

      expect(status()).toBe('Added 4 · skipped 1 duplicate');
      expect(statusRegion().classes()).toContain('visually-hidden'); // screen readers only
      expect(addInput().element.value).toBe('');
      expect(wrapper!.get('h2').text()).toBe('4 terms');
      expect(rowTerms()).toEqual(['Oticon', 'Philips', 'hearing aid', 'Hörgerät']);
      expect(stored()).toEqual(['Oticon', 'Philips', 'hearing aid', 'Hörgerät']);
    });

    it('adds with Ctrl+Enter', async () => {
      mountEditor();
      await addInput().setValue('Oticon, Demant');
      await addInput().trigger('keydown', { key: 'Enter', ctrlKey: true });
      expect(status()).toBe('Added 2');
      expect(rowTerms()).toEqual(['Oticon', 'Demant']);
    });

    it('does not add on a plain Enter', async () => {
      mountEditor();
      await addInput().setValue('Oticon');
      await addInput().trigger('keydown', { key: 'Enter' });
      expect(rowTerms()).toEqual([]);
    });

    it('disables Add while the textarea is blank', async () => {
      mountEditor();
      expect(button('Add')!.attributes('disabled')).toBeDefined();
      await addInput().setValue('  \n ');
      expect(button('Add')!.attributes('disabled')).toBeDefined();
      await addInput().setValue('x');
      expect(button('Add')!.attributes('disabled')).toBeUndefined();
    });

    it('says when the text held only separators', async () => {
      mountEditor();
      await addInput().setValue(', ;');
      await button('Add')!.trigger('click');
      expect(status()).toBe('No terms found.');
      expect(statusRegion().classes()).not.toContain('visually-hidden');
    });

    it('uses the singular for one term and one duplicate', async () => {
      mountEditor(['Oticon']);
      expect(wrapper!.get('h2').text()).toBe('1 term');
      await addInput().setValue('oticon');
      await button('Add')!.trigger('click');
      expect(status()).toBe('Added 0 · skipped 1 duplicate');
    });
  });

  describe('editing', () => {
    it('saves an edit with Enter and returns focus to the Edit button', async () => {
      mountEditor(['Oticon', 'Philips']);
      await byLabel('Edit term Philips').trigger('click');
      await flushPromises();
      expect(editInput().element.value).toBe('Philips');
      expect(document.activeElement).toBe(editInput().element);
      expect(wrapper!.get(`label[for="${editInput().attributes('id')}"]`).text()).toBe('Edit term');

      await editInput().setValue('Philips Hue');
      await editInput().trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(editInput().exists()).toBe(false);
      expect(rowTerms()).toEqual(['Oticon', 'Philips Hue']);
      expect(stored()).toEqual(['Oticon', 'Philips Hue']);
      expect(document.activeElement).toBe(byLabel('Edit term Philips Hue').element);
    });

    it('starts editing when the term text is clicked', async () => {
      mountEditor(['Oticon']);
      await wrapper!.get('li .chip-term').trigger('click');
      await flushPromises();
      expect(editInput().element.value).toBe('Oticon');
    });

    it('saves on blur', async () => {
      mountEditor(['Oticon']);
      await byLabel('Edit term Oticon').trigger('click');
      await flushPromises();
      await editInput().setValue('Oticon Intent');
      await editInput().trigger('blur');
      expect(editInput().exists()).toBe(false);
      expect(stored()).toEqual(['Oticon Intent']);
    });

    it('keeps editing with an error for a duplicate', async () => {
      mountEditor(['Oticon', 'Philips']);
      await byLabel('Edit term Philips').trigger('click');
      await flushPromises();
      await editInput().setValue('OTICON');
      await editInput().trigger('keydown', { key: 'Enter' });

      expect(editInput().exists()).toBe(true);
      expect(editInput().attributes('aria-invalid')).toBe('true');
      const errorId = editInput().attributes('aria-describedby');
      expect(wrapper!.get(`#${errorId}`).text()).toBe('That term is already in the list.');
      expect(stored()).toEqual(['Oticon', 'Philips']);

      // Fixing the value saves it.
      await editInput().setValue('Philips Hue');
      await editInput().trigger('keydown', { key: 'Enter' });
      expect(editInput().exists()).toBe(false);
      expect(stored()).toEqual(['Oticon', 'Philips Hue']);
    });

    it('keeps editing with an error for an empty value, also on blur', async () => {
      mountEditor(['Oticon']);
      await byLabel('Edit term Oticon').trigger('click');
      await flushPromises();
      await editInput().setValue('   ');
      await editInput().trigger('blur');
      expect(editInput().exists()).toBe(true);
      expect(wrapper!.text()).toContain("A term can't be empty.");
      expect(stored()).toEqual(['Oticon']);
    });

    it('cancels with Escape and returns focus to the Edit button', async () => {
      mountEditor(['Oticon', 'Philips']);
      await byLabel('Edit term Oticon').trigger('click');
      await flushPromises();
      await editInput().setValue('Something else');
      await editInput().trigger('keydown', { key: 'Escape' });
      await flushPromises();

      expect(editInput().exists()).toBe(false);
      expect(rowTerms()).toEqual(['Oticon', 'Philips']);
      expect(stored()).toEqual(['Oticon', 'Philips']);
      expect(document.activeElement).toBe(byLabel('Edit term Oticon').element);
    });
  });

  describe('deleting', () => {
    it('deletes a term and moves focus to the next Delete button', async () => {
      mountEditor(['a', 'b', 'c']);
      await byLabel('Delete term b').trigger('click');
      await flushPromises();
      expect(rowTerms()).toEqual(['a', 'c']);
      expect(stored()).toEqual(['a', 'c']);
      expect(status()).toBe('Deleted b.');
      expect(document.activeElement).toBe(byLabel('Delete term c').element);
    });

    it('moves focus to the previous row after deleting the last one, then to the textarea', async () => {
      mountEditor(['a', 'b']);
      await byLabel('Delete term b').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(byLabel('Delete term a').element);

      await byLabel('Delete term a').trigger('click');
      await flushPromises();
      expect(stored()).toEqual([]);
      expect(document.activeElement).toBe(addInput().element);
    });

    it('drops an open edit, since the rows shift', async () => {
      mountEditor(['a', 'b', 'c', 'd']);
      await byLabel('Edit term c').trigger('click');
      await flushPromises();
      await editInput().setValue('');
      await editInput().trigger('blur'); // stays open with an error
      await byLabel('Delete term a').trigger('click');
      await flushPromises();
      // Otherwise the edit would jump to "d", which now has c's old index.
      expect(editInput().exists()).toBe(false);
      expect(rowTerms()).toEqual(['b', 'c', 'd']);
    });
  });

  describe('Clear all', () => {
    it('removes every term after confirmation and focuses the textarea', async () => {
      mountEditor(['a', 'b', 'c']);
      await button('Clear all')!.trigger('click');
      await flushPromises();
      const dialog = wrapper!.get<HTMLDialogElement>('dialog');
      expect(dialog.element.open).toBe(true);
      expect(dialog.text()).toContain("Remove all 3 terms? This can't be undone.");

      await dialog
        .findAll('button')
        .find((b) => b.text() === 'Remove all')!
        .trigger('click');
      await flushPromises();
      expect(dialog.element.open).toBe(false);
      expect(stored()).toEqual([]);
      expect(wrapper!.text()).toContain('A glossary is optional');
      expect(status()).toBe('Removed all terms.');
      expect(document.activeElement).toBe(addInput().element);
    });

    it('keeps the terms when cancelled', async () => {
      mountEditor(['a', 'b']);
      button('Clear all')!.element.focus(); // a real click focuses the button; trigger() doesn't
      await button('Clear all')!.trigger('click');
      await flushPromises();
      const dialog = wrapper!.get<HTMLDialogElement>('dialog');
      await dialog
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
        .trigger('click');
      await flushPromises();
      expect(dialog.element.open).toBe(false);
      expect(stored()).toEqual(['a', 'b']);
      expect(rowTerms()).toEqual(['a', 'b']);
      expect(document.activeElement).toBe(button('Clear all')!.element);
    });
  });

  describe('skipped terms', () => {
    const fifty = 'a'.repeat(50);
    const fortyNine = 'b'.repeat(49);

    const skipList = () => wrapper!.get('details.skip-list');

    it('marks invalid terms, counts them and lists the reasons', () => {
      mountEditor(['Oticon', fifty, fortyNine, 'Foo [bar]', 'one two three four five six']);
      const skipped = chips().filter((c) => c.classes('skipped'));
      expect(skipped.map((c) => c.get('.chip-term').text())).toEqual([
        fifty,
        'Foo [bar]',
        'one two three four five six',
      ]);
      // Colour isn't the only mark: the name says so too.
      expect(skipped[1]!.get('.chip-term').attributes('aria-label')).toBe(
        'Edit term Foo [bar] (skipped)',
      );
      expect(skipList().get('summary').text()).toBe('3 terms will be skipped');
      expect(
        skipList()
          .findAll('li')
          .map((li) => li.text()),
      ).toEqual([
        `${fifty}: 50 characters or more`,
        'Foo [bar]: contains < > { } [ ] or \\',
        'one two three four five six: more than 5 words',
      ]);
      expect(useGlossaryStore().validTerms).toEqual(['Oticon', fortyNine]);
    });

    it('joins several reasons for one term', () => {
      const term = `${'a'.repeat(45)} b c d e [f]`;
      mountEditor([term]);
      expect(skipList().get('summary').text()).toBe('1 term will be skipped');
      expect(skipList().get('li').text()).toBe(
        `${term}: 50 characters or more; more than 5 words; contains < > { } [ ] or \\`,
      );
    });

    it('marks terms beyond the 1000-term limit', () => {
      mountEditor(Array.from({ length: 1001 }, (_, i) => `term ${i}`));
      const skipped = chips().filter((c) => c.classes('skipped'));
      expect(skipped).toHaveLength(1);
      expect(skipList().get('li').text()).toBe('term 1000: over the limit of 1000 terms');
    });

    it('shows no notice when every term is valid', () => {
      mountEditor(['Oticon']);
      expect(wrapper!.text()).not.toContain('will be skipped');
      expect(wrapper!.find('.skip-list').exists()).toBe(false);
      expect(wrapper!.find('.skipped').exists()).toBe(false);
    });
  });

  describe('Copy list', () => {
    it('copies the newline-separated terms', async () => {
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      mountEditor(['Oticon', 'Philips', 'Hörgerät']);
      await button('Copy list')!.trigger('click');
      await flushPromises();
      expect(writeText).toHaveBeenCalledWith('Oticon\nPhilips\nHörgerät');
      expect(status()).toBe('Copied 3 terms.');
      expect(statusRegion().classes()).not.toContain('visually-hidden');
      expect(wrapper!.find('.copy-fallback').exists()).toBe(false);
    });

    it('falls back to a selected read-only textarea when the clipboard refuses', async () => {
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      mountEditor(['Oticon', 'Philips']);
      await button('Copy list')!.trigger('click');
      await flushPromises();

      const area = wrapper!.get<HTMLTextAreaElement>('.copy-fallback textarea');
      expect(area.element.value).toBe('Oticon\nPhilips');
      expect(area.attributes('readonly')).toBeDefined();
      expect(document.activeElement).toBe(area.element);
      expect(area.element.selectionStart).toBe(0);
      expect(area.element.selectionEnd).toBe('Oticon\nPhilips'.length);
      expect(status()).toContain('press Ctrl+C');

      await button('Close')!.trigger('click');
      await flushPromises();
      expect(wrapper!.find('.copy-fallback').exists()).toBe(false);
      expect(document.activeElement).toBe(button('Copy list')!.element);
    });
  });

  it('warns when the browser does not save the list', async () => {
    const real = window.localStorage;
    const failing = {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: (key: string) => real.removeItem(key),
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(failing);

    mountEditor();
    expect(wrapper!.text()).not.toContain("isn't saving");
    await addInput().setValue('Oticon');
    await button('Add')!.trigger('click');
    expect(wrapper!.text()).toContain(
      "This browser isn't saving the glossary, so it will be lost when you close the tab.",
    );
  });
});

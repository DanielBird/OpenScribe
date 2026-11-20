import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  formatTimestamp,
  type TranscriptDoc,
  type TranscriptVersion,
} from '../../domain/transcript';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc, withTranslation } from '../../testing/transcriptDoc';
import ReplaceDialog from './ReplaceDialog.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  saveTranscriptLink: vi.fn(() => Promise.resolve(true)),
}));

/** Find waits this long for the typing to stop (the component's SEARCH_DELAY_MS). */
const DELAY = 150;

/** `makeDoc()` with Anna twice in t1 and once in t3, and Annabel (not a match) in t2. */
function named(): TranscriptDoc {
  const texts: Record<string, string> = {
    t1: 'Anna fragte anna nach dem Weg.',
    t2: 'Danke, Annabel.',
    t3: 'Wie lange arbeitet ANNA schon an dem Projekt?',
  };
  const doc = makeDoc();
  return { ...doc, turns: doc.turns.map((t) => ({ ...t, text: texts[t.id] ?? t.text })) };
}

/** English for `named()`: Anna only in t2's English, and t5 has no English of its own. */
const ENGLISH = {
  t1: 'Good afternoon.',
  t2: 'Thank you, Anna.',
  t3: 'How long?',
  t4: 'Two years.',
};

describe('ReplaceDialog', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    // Only the timers: flushPromises and the store's promises still run.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useTranscriptStore().$dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function open(
    options: { doc?: TranscriptDoc; version?: TranscriptVersion; initialFind?: string } = {},
  ) {
    const transcript = useTranscriptStore();
    await transcript.setDoc(options.doc ?? named());
    wrapper = mount(ReplaceDialog, {
      props: {
        open: true,
        version: options.version ?? 'original',
        initialFind: options.initialFind,
      },
      attachTo: document.body,
    });
    await nextTick();
    return transcript;
  }

  const input = (label: string) => {
    const l = wrapper!.findAll('label').find((x) => x.text() === label)!;
    return wrapper!.get<HTMLInputElement>(`#${l.attributes('for')}`);
  };
  const button = (name: string) =>
    wrapper!.findAll('.actions button').find((b) => b.text() === name)!;
  const rows = () => wrapper!.findAll('[role="option"]');
  const currentRow = () => wrapper!.findAll('[role="option"][aria-selected="true"]');
  const count = () => wrapper!.find('.count');
  const live = () => wrapper!.get('[aria-live="polite"]').text();

  async function typeFind(text: string): Promise<void> {
    await input('Find').setValue(text);
    vi.advanceTimersByTime(DELAY);
    await nextTick();
  }

  async function typeReplace(text: string): Promise<void> {
    await input('Replace with').setValue(text);
  }

  it('opens with focus in an empty Find, and no count or list', async () => {
    await open();
    expect(wrapper!.get('dialog').element.open).toBe(true);
    expect(document.activeElement).toBe(input('Find').element);
    expect(input('Find').element.value).toBe('');
    expect(count().exists()).toBe(false);
    expect(rows()).toHaveLength(0);
  });

  it('starts from initialFind and lists its matches at once', async () => {
    await open({ initialFind: 'Anna' });
    expect(input('Find').element.value).toBe('Anna');
    expect(rows()).toHaveLength(3);
    expect(count().text()).toBe('1 of 3');
  });

  it('lists every whole-word match, in any case, once the typing stops', async () => {
    const doc = named();
    await open({ doc });
    await input('Find').setValue('anna');
    vi.advanceTimersByTime(DELAY - 1);
    await nextTick();
    expect(rows()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(rows().map((r) => r.get('mark').text())).toEqual(['Anna', 'anna', 'ANNA']);
    expect(count().text()).toBe('1 of 3');
    const t3 = doc.turns[2]!;
    const label = doc.speakers.find((s) => s.id === t3.speakerId)!.label;
    expect(rows()[2]!.get('.time').text()).toBe(formatTimestamp(t3.start));
    expect(rows()[2]!.get('.speaker').text()).toBe(label);
    expect(rows()[2]!.get('.snippet').text()).toBe('Wie lange arbeitet ANNA schon an dem Projekt?');
    expect(currentRow()).toHaveLength(1);
    expect(currentRow()[0]!.element).toBe(rows()[0]!.element);
  });

  it('says No matches once Find has text, and nothing while it is empty', async () => {
    await open();
    await typeFind('Zoe');
    expect(count().text()).toBe('No matches');
    await typeFind('!!');
    expect(count().text()).toBe('No matches');
    await typeFind('');
    expect(count().exists()).toBe(false);
  });

  it('Next moves through the matches and wraps, and says which is current', async () => {
    const doc = named();
    await open({ doc, initialFind: 'Anna' });
    await button('Next').trigger('click');
    expect(currentRow()[0]!.element).toBe(rows()[1]!.element);
    expect(count().text()).toBe('2 of 3');
    await nextTick();
    const t1 = doc.turns[0]!;
    const label = doc.speakers.find((s) => s.id === t1.speakerId)!.label;
    expect(live()).toBe(`2 of 3: ${label}, ${formatTimestamp(t1.start)}`);

    await button('Next').trigger('click');
    await button('Next').trigger('click');
    expect(currentRow()[0]!.element).toBe(rows()[0]!.element);
    expect(count().text()).toBe('1 of 3');
  });

  it('Enter in Find or Replace with is Next', async () => {
    await open({ initialFind: 'Anna' });
    await input('Find').trigger('keydown', { key: 'Enter' });
    expect(count().text()).toBe('2 of 3');
    await input('Replace with').trigger('keydown', { key: 'Enter' });
    expect(count().text()).toBe('3 of 3');
  });

  it('Enter in Find searches at once when the typing has not stopped yet', async () => {
    await open();
    await input('Find').setValue('Anna');
    await input('Find').trigger('keydown', { key: 'Enter' });
    expect(count().text()).toBe('1 of 3');
  });

  it('clicking a row makes it current', async () => {
    await open({ initialFind: 'Anna' });
    await rows()[2]!.trigger('click');
    expect(currentRow()[0]!.element).toBe(rows()[2]!.element);
    expect(count().text()).toBe('3 of 3');
  });

  it('keeps Replace and Replace all disabled until Replace with has text', async () => {
    await open({ initialFind: 'Anna' });
    expect(button('Replace').attributes('disabled')).toBeDefined();
    expect(button('Replace all').attributes('disabled')).toBeDefined();
    await typeReplace('   ');
    expect(button('Replace').attributes('disabled')).toBeDefined();
    await typeReplace('Participant 1');
    expect(button('Replace').attributes('disabled')).toBeUndefined();
    expect(button('Replace all').attributes('disabled')).toBeUndefined();
  });

  it('Replace replaces the current match, drops its row and moves on', async () => {
    const transcript = await open({ initialFind: 'Anna' });
    await typeReplace(' Participant 1 ');
    await button('Replace').trigger('click');

    expect(transcript.doc!.turns[0]!.text).toBe('Participant 1 fragte anna nach dem Weg.');
    expect(rows()).toHaveLength(2);
    expect(count().text()).toBe('1 of 2');
    // The later match in the same turn still points at its text.
    expect(currentRow()[0]!.get('mark').text()).toBe('anna');
    expect(currentRow()[0]!.get('.snippet').text()).toBe('Participant 1 fragte anna nach dem Weg.');

    await button('Replace').trigger('click');
    expect(transcript.doc!.turns[0]!.text).toBe('Participant 1 fragte Participant 1 nach dem Weg.');
    expect(rows()).toHaveLength(1);
  });

  it('leaves a skipped match in the list', async () => {
    const transcript = await open({ initialFind: 'Anna' });
    await typeReplace('P1');
    await button('Next').trigger('click');
    await button('Replace').trigger('click');
    expect(transcript.doc!.turns[0]!.text).toBe('Anna fragte P1 nach dem Weg.');
    expect(rows().map((r) => r.get('mark').text())).toEqual(['Anna', 'ANNA']);
    // Moved on to ANNA, the one after the replaced match.
    expect(currentRow()[0]!.get('mark').text()).toBe('ANNA');
  });

  it('wraps to the first match after replacing the last, and counts the replaced once none are left', async () => {
    await open({ initialFind: 'Anna' });
    await typeReplace('P1');
    await rows()[2]!.trigger('click');
    await button('Replace').trigger('click');
    expect(count().text()).toBe('1 of 2');
    await button('Replace').trigger('click');
    await button('Replace').trigger('click');
    expect(rows()).toHaveLength(0);
    expect(count().text()).toBe('3 replaced');
    await nextTick();
    expect(live()).toBe('3 replaced');
  });

  it('Replace all asks first, with focus on Cancel, and Cancel changes nothing', async () => {
    const transcript = await open({ initialFind: 'Anna' });
    const before = transcript.doc;
    await typeReplace('P1');
    await button('Replace all').trigger('click');
    await nextTick();

    expect(wrapper!.get('.question').text()).toBe('Replace all 3?');
    expect(wrapper!.findAll('.actions button').map((b) => b.text())).toEqual([
      'Cancel',
      'Replace all',
    ]);
    expect(button('Replace all').classes()).toContain('button-danger');
    expect(document.activeElement).toBe(button('Cancel').element);

    await button('Cancel').trigger('click');
    await nextTick();
    expect(wrapper!.find('.question').exists()).toBe(false);
    expect(document.activeElement).toBe(button('Replace all').element);
    expect(transcript.doc).toBe(before);
    expect(rows()).toHaveLength(3);
  });

  it('Replace all replaces every remaining match, says how many and goes back to Find', async () => {
    const transcript = await open({ initialFind: 'Anna' });
    await typeReplace('P1');
    await button('Replace all').trigger('click');
    await nextTick();
    await button('Replace all').trigger('click');
    await nextTick();

    expect(transcript.doc!.turns.map((t) => t.text).slice(0, 3)).toEqual([
      'P1 fragte P1 nach dem Weg.',
      'Danke, Annabel.',
      'Wie lange arbeitet P1 schon an dem Projekt?',
    ]);
    expect(rows()).toHaveLength(0);
    expect(count().text()).toBe('3 replaced');
    expect(live()).toBe('3 replaced');
    expect(document.activeElement).toBe(input('Find').element);
    expect(wrapper!.find('.question').exists()).toBe(false);
  });

  it('a new Find takes back the confirmation', async () => {
    await open({ initialFind: 'Anna' });
    await typeReplace('P1');
    await button('Replace all').trigger('click');
    await input('Find').setValue('Annabel');
    expect(wrapper!.find('.question').exists()).toBe(false);
  });

  it('in the English view says so, and searches and changes only the English', async () => {
    const doc = withTranslation(named(), ENGLISH);
    const transcript = await open({ doc, version: 'en', initialFind: 'Anna' });
    const dialog = wrapper!.get('dialog');
    expect(dialog.get(`#${dialog.attributes('aria-describedby')}`).text()).toBe(
      'In the English translation',
    );
    expect(rows().map((r) => r.get('.snippet').text())).toEqual(['Thank you, Anna.']);

    await typeReplace('P1');
    await button('Replace').trigger('click');
    expect(transcript.doc!.translations.en!.texts.t2).toBe('Thank you, P1.');
    expect(transcript.doc!.turns).toBe(doc.turns);
  });

  it('only lists English turns that have their own English', async () => {
    const doc = withTranslation(
      { ...named(), turns: named().turns.map((t) => (t.id === 't5' ? { ...t, text: 'Anna' } : t)) },
      ENGLISH,
    );
    await open({ doc, version: 'en', initialFind: 'Anna' });
    expect(rows()).toHaveLength(1);
  });

  it('has no English line in the Original', async () => {
    await open();
    expect(wrapper!.find('.version').exists()).toBe(false);
    expect(wrapper!.get('dialog').attributes('aria-describedby')).toBeUndefined();
  });

  it('closes on Close and on Escape', async () => {
    await open();
    await button('Close').trigger('click');
    expect(wrapper!.emitted('close')).toHaveLength(1);

    const cancel = new Event('cancel', { cancelable: true });
    wrapper!.get('dialog').element.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(wrapper!.emitted('close')).toHaveLength(2);
  });

  it('holds no matches, names or English line while closed', async () => {
    await open({ doc: withTranslation(named(), ENGLISH), version: 'en', initialFind: 'Anna' });
    await wrapper!.setProps({ open: false });
    expect(rows()).toHaveLength(0);
    expect(count().exists()).toBe(false);
    expect(wrapper!.find('.version').exists()).toBe(false);
    expect(input('Find').element.value).toBe('');
  });

  it('starts afresh each time it opens', async () => {
    await open({ initialFind: 'Anna' });
    await typeReplace('P1');
    await wrapper!.setProps({ open: false });
    await wrapper!.setProps({ open: true, initialFind: undefined });
    expect(input('Find').element.value).toBe('');
    expect(input('Replace with').element.value).toBe('');
    expect(rows()).toHaveLength(0);
  });
});

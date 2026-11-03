import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makeLargeDoc, TEST_TRANSLATION_TEXTS } from '../../testing/transcriptDoc';
import TurnList from './TurnList.vue';

describe('TurnList', () => {
  const doc = makeDoc();

  it('renders each turn with its timestamp, speaker label and text', () => {
    const wrapper = mount(TurnList, { props: { turns: doc.turns, speakers: doc.speakers } });
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.get('.timestamp').text())).toEqual([
      '00:00:00',
      '00:00:03',
      '00:00:06',
      '00:00:09',
      '00:00:13',
    ]);
    expect(items.map((li) => li.get('.speaker').text())).toEqual([
      'Speaker 1',
      'Speaker 2',
      'Speaker 1',
      'Speaker 2',
      'Speaker 1',
    ]);
    expect(items[0]?.get('.text').text()).toBe('Guten Tag und willkommen zu unserem Gespräch.');
    // Reading order is timestamp, speaker, text: screen readers hear "00:00:00 Speaker 1: Guten Tag …".
    expect(items[0]?.text()).toBe(
      '00:00:00Speaker 1: Guten Tag und willkommen zu unserem Gespräch.',
    );
  });

  it('colours each speaker from the palette, in order of first appearance', () => {
    const wrapper = mount(TurnList, { props: { turns: doc.turns, speakers: doc.speakers } });
    const colors = wrapper.findAll('.turn').map((t) => t.attributes('style'));
    expect(colors[0]).toContain('var(--speaker-1)');
    expect(colors[1]).toContain('var(--speaker-2)');
    expect(colors[2]).toBe(colors[0]);
  });

  it('shows timestamps as text until playback is available', () => {
    const wrapper = mount(TurnList, { props: { turns: doc.turns, speakers: doc.speakers } });
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('emits select with the turn when a playable timestamp is clicked', async () => {
    const wrapper = mount(TurnList, {
      props: { turns: doc.turns, speakers: doc.speakers, playable: true },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(5);
    expect(buttons[1]?.attributes('aria-label')).toBe('Play from 00:00:03');
    await buttons[1]?.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[doc.turns[1]]]);
  });

  it('shows a renamed speaker in every one of their turns', async () => {
    const wrapper = mount(TurnList, { props: { turns: doc.turns, speakers: doc.speakers } });
    const renamed = doc.speakers.map((s) =>
      s.id === 'speaker_0' ? { ...s, label: 'Interviewer' } : s,
    );
    await wrapper.setProps({ speakers: renamed });
    expect(wrapper.findAll('.speaker').map((s) => s.text())).toEqual([
      'Interviewer',
      'Speaker 2',
      'Interviewer',
      'Speaker 2',
      'Interviewer',
    ]);
  });

  it('shows the given texts instead of the original, with the same speakers and timestamps', async () => {
    const wrapper = mount(TurnList, { props: { turns: doc.turns, speakers: doc.speakers } });
    const original = wrapper
      .findAll('li')
      .map((li) => [li.get('.timestamp').text(), li.get('.speaker').text()]);

    await wrapper.setProps({ texts: TEST_TRANSLATION_TEXTS, lang: 'en' });
    const items = wrapper.findAll('li');
    expect(items.map((li) => li.get('.text').text())).toEqual(
      Object.values(TEST_TRANSLATION_TEXTS),
    );
    expect(items.map((li) => [li.get('.timestamp').text(), li.get('.speaker').text()])).toEqual(
      original,
    );
    expect(wrapper.get('ol').attributes('lang')).toBe('en');

    await wrapper.setProps({ texts: undefined, lang: 'de' });
    expect(wrapper.findAll('.text')[0]?.text()).toBe(
      'Guten Tag und willkommen zu unserem Gespräch.',
    );
    expect(wrapper.get('ol').attributes('lang')).toBe('de');
  });

  it('marks the turns whose translation is out of date, and only those (D39)', async () => {
    const wrapper = mount(TurnList, {
      props: {
        turns: doc.turns,
        speakers: doc.speakers,
        texts: TEST_TRANSLATION_TEXTS,
        outdated: new Set(['t2']),
      },
    });
    const items = wrapper.findAll('li');
    expect(items.map((li) => li.find('.outdated').exists())).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(items[1]?.get('.outdated').text()).toBe('Changed since translation');
    expect(items[1]?.text()).toBe(
      `00:00:03Changed since translationSpeaker 2: ${TEST_TRANSLATION_TEXTS.t2}`,
    );

    await wrapper.setProps({ outdated: undefined });
    expect(wrapper.find('.outdated').exists()).toBe(false);
  });

  it('falls back to the original text for a turn without a translation', () => {
    const wrapper = mount(TurnList, {
      props: { turns: doc.turns, speakers: doc.speakers, texts: { t1: 'Hello.' } },
    });
    const texts = wrapper.findAll('.text').map((t) => t.text());
    expect(texts[0]).toBe('Hello.');
    expect(texts[1]).toBe(doc.turns[1]!.text);
  });

  describe('playback', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const playable = (props: Record<string, unknown> = {}) =>
      mount(TurnList, {
        props: { turns: doc.turns, speakers: doc.speakers, playable: true, ...props },
      });

    it('marks the turn being played', async () => {
      const wrapper = playable({ activeId: 't3' });
      const items = wrapper.findAll('li');
      expect(items[2]?.classes()).toContain('is-active');
      expect(items[2]?.attributes('aria-current')).toBe('true');
      expect(items.filter((li) => li.classes().includes('is-active'))).toHaveLength(1);
      expect(items[0]?.attributes('aria-current')).toBeUndefined();

      await wrapper.setProps({ activeId: 't4' });
      expect(items[2]?.classes()).not.toContain('is-active');
      expect(items[3]?.classes()).toContain('is-active');
      expect(items[3]?.attributes('style')).toContain('--turn-color: var(--speaker-2)');
    });

    it('plays from a turn when its text is clicked', async () => {
      const wrapper = playable();
      await wrapper.findAll('.text')[2]?.trigger('click');
      expect(wrapper.emitted('select')).toEqual([[doc.turns[2]]]);
    });

    it('does not play when the click ends a text selection', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection);
      const wrapper = playable();
      await wrapper.findAll('.text')[2]?.trigger('click');
      expect(wrapper.emitted('select')).toBeUndefined();
    });

    it('does not play from the text until the recording is attached', async () => {
      const wrapper = playable({ playable: false });
      await wrapper.findAll('.text')[2]?.trigger('click');
      expect(wrapper.emitted('select')).toBeUndefined();
    });

    it('scrolls to the new active turn when following', async () => {
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
      const wrapper = playable({ follow: true });
      await wrapper.setProps({ activeId: 't4' });
      await flushPromises();
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(wrapper.findAll('li')[3]?.element);
      expect(scroll.mock.calls[0]?.[0]).toMatchObject({ block: 'nearest' });
    });

    it('does not scroll when not following, and catches up when following is switched on', async () => {
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
      const wrapper = playable({ follow: false });
      await wrapper.setProps({ activeId: 't4' });
      await flushPromises();
      expect(scroll).not.toHaveBeenCalled();

      await wrapper.setProps({ follow: true });
      await flushPromises();
      expect(scroll).toHaveBeenCalledOnce();
      expect(scroll.mock.contexts[0]).toBe(wrapper.findAll('li')[3]?.element);
    });
  });

  describe('editing', () => {
    let wrapper: VueWrapper | null = null;
    const original = doc.turns[0]!.text;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      vi.restoreAllMocks();
      Reflect.deleteProperty(document, 'execCommand');
    });

    // Attached, so focus and blur work.
    const editable = (props: Record<string, unknown> = {}) => {
      wrapper = mount(TurnList, {
        props: { turns: doc.turns, speakers: doc.speakers, editable: true, ...props },
        attachTo: document.body,
      });
      return wrapper;
    };
    const box = (w: VueWrapper, i: number) => w.findAll('textarea')[i]!.element;
    const key = (el: Element, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(event);
      return event;
    };
    const paste = (el: Element, text: string) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      el.dispatchEvent(event);
      return event;
    };
    const type = (el: HTMLTextAreaElement, value: string) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    it('shows each text in a box named after its speaker and time', async () => {
      const w = editable();
      const boxes = w.findAll('textarea');
      expect(boxes).toHaveLength(5);
      expect(w.findAll('p.text')).toHaveLength(0);
      expect(boxes.map((b) => b.attributes('aria-label'))).toEqual([
        'Speaker 1, 00:00:00',
        'Speaker 2, 00:00:03',
        'Speaker 1, 00:00:06',
        'Speaker 2, 00:00:09',
        'Speaker 1, 00:00:13',
      ]);
      expect(box(w, 0).value).toBe(original);
      expect(boxes[0]?.attributes('rows')).toBe('1');

      await w.setProps({ editable: false });
      expect(w.findAll('textarea')).toHaveLength(0);
      expect(w.findAll('p.text')).toHaveLength(5);
    });

    it('emits each change with the turn id, and shows exactly what was typed', async () => {
      const w = editable();
      const el = box(w, 1);
      el.focus();
      type(el, 'Danke ');
      expect(w.emitted('edit')).toEqual([['t2', 'Danke ']]);

      // The store saves the cleaned text; the box keeps the space until it loses focus.
      await w.setProps({
        turns: doc.turns.map((t) => (t.id === 't2' ? { ...t, text: 'Danke' } : t)),
      });
      expect(el.value).toBe('Danke ');
      el.blur();
      await flushPromises();
      expect(el.value).toBe('Danke');
    });

    it('finishes on Enter without a line break, but not while an IME is composing', () => {
      const w = editable();
      const el = box(w, 0);
      el.focus();
      expect(key(el, { key: 'Enter', isComposing: true }).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(el);

      expect(key(el, { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(el);
      expect(el.value).toBe(original);
    });

    it('puts back the text from before on Escape', async () => {
      const w = editable();
      const el = box(w, 0);
      el.focus();
      type(el, 'Something else');
      expect(key(el, { key: 'Escape' }).defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(el);
      expect(w.emitted('edit')).toEqual([
        ['t1', 'Something else'],
        ['t1', original],
      ]);
      await flushPromises();
      expect(el.value).toBe(original);
    });

    it('puts back the text from before when a box is left empty', async () => {
      const w = editable();
      const el = box(w, 0);
      el.focus();
      type(el, ' \n ');
      el.blur();
      expect(w.emitted('edit')?.at(-1)).toEqual(['t1', original]);
      await flushPromises();
      expect(el.value).toBe(original);
    });

    it('pastes several lines as one, with insertText so Ctrl+Z still works', () => {
      const exec = vi.fn(() => true);
      Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
      const w = editable();
      const el = box(w, 0);
      el.focus();
      expect(paste(el, 'one\ntwo\r\n\r\nthree').defaultPrevented).toBe(true);
      expect(exec).toHaveBeenCalledExactlyOnceWith('insertText', false, 'one two three');

      // Text without line breaks is left to the browser.
      expect(paste(el, 'plain').defaultPrevented).toBe(false);
    });

    it('pastes several lines as one where insertText is not available', () => {
      const w = editable();
      const el = box(w, 0);
      el.focus();
      el.setSelectionRange(original.length, original.length);
      paste(el, ' and\nmore\n');
      expect(el.value).toBe(`${original} and more `);
      expect(w.emitted('edit')).toEqual([['t1', `${original} and more `]]);
    });

    it('replaces a line break that gets in another way, e.g. by drag and drop', () => {
      const w = editable();
      const el = box(w, 0);
      el.focus();
      el.value = 'one\n\ntwo three';
      el.setSelectionRange(8, 8); // after "two"
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(el.value).toBe('one two three');
      expect(el.selectionStart).toBe(7);
      expect(w.emitted('edit')).toEqual([['t1', 'one two three']]);
    });

    it('does not play when a box is clicked, but the timestamp still does', async () => {
      const w = editable({ playable: true });
      await w.findAll('textarea')[2]?.trigger('click');
      expect(w.emitted('select')).toBeUndefined();
      await w.findAll('button')[2]?.trigger('click');
      expect(w.emitted('select')).toEqual([[doc.turns[2]]]);
    });

    it('does not scroll to the playing turn while a box has focus', async () => {
      const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
      const w = editable({ playable: true, follow: true });
      const el = box(w, 0);
      el.focus();
      await w.setProps({ activeId: 't4' });
      await flushPromises();
      expect(scroll).not.toHaveBeenCalled();
      expect(w.findAll('li')[3]?.classes()).toContain('is-active');

      el.blur();
      await w.setProps({ activeId: 't5' });
      await flushPromises();
      expect(scroll).toHaveBeenCalledOnce();
    });
  });

  it('renders 2000 turns', () => {
    const large = makeLargeDoc(2000, 3);
    const wrapper = mount(TurnList, { props: { turns: large.turns, speakers: large.speakers } });
    expect(wrapper.findAll('li')).toHaveLength(2000);
    expect(wrapper.findAll('li').at(-1)?.get('.speaker').text()).toBe('Speaker 2');
  });
});

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionText } from '../../domain/corpus/sessionText';
import { SEARCH_PAGE_SESSIONS, useProjectStore } from '../../stores/project';
import { makeProjectSession, makeSessionText } from '../../testing/projectSessions';
import SessionSearch from './SessionSearch.vue';

describe('SessionSearch', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mountWith(texts: SessionText[]) {
    const project = useProjectStore();
    project.sessions = texts.map((t) => makeProjectSession(t));
    project.corpus = texts;
    wrapper = mount(SessionSearch, { attachTo: document.body });
    return project;
  }

  const input = () => wrapper!.get<HTMLInputElement>('input[type="search"]');
  const status = () => wrapper!.get('[role="status"]');
  const results = () => wrapper!.findAll('li.result');

  async function type(text: string) {
    await input().setValue(text);
    await vi.advanceTimersByTimeAsync(250);
  }

  it('is a labelled search box, with no results until something is typed', () => {
    mountWith([makeSessionText(1)]);
    const id = input().attributes('id');
    expect(wrapper!.get(`label[for="${id}"]`).text()).toBe('Search transcripts');
    expect(input().attributes('placeholder')).toBe('Search transcripts');
    expect(results()).toHaveLength(0);
    expect(status().text()).toBe('');
  });

  it('searches 250 ms after the last keystroke, with the results above the box', async () => {
    mountWith([makeSessionText(1), makeSessionText(2)]);
    await input().setValue('charger');
    await vi.advanceTimersByTimeAsync(200);
    expect(results()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60);
    expect(status().text()).toBe('2 hits in 2 sessions');
    expect(wrapper!.find('.results-area + .box').exists()).toBe(true);
    expect(results().map((r) => r.get('h3').text().replace(/\s+/g, ' '))).toEqual([
      'P02 interview.m4a 1 hit',
      'P01 interview.m4a 1 hit',
    ]);
    const hit = results()[0]!.get('li.hit');
    expect(hit.get('.speaker').text()).toBe('Anna');
    expect(hit.get('.time').text()).toBe('00:01:01');
    expect(hit.get('.snippet').text()).toBe('I put them on the charger by the bed.');
    expect(hit.findAll('mark').map((m) => m.text())).toEqual(['charger']);
  });

  it('searches at once on Enter', async () => {
    mountWith([makeSessionText(1)]);
    await input().setValue('bed');
    await input().trigger('keydown', { key: 'Enter' });
    expect(status().text()).toBe('1 hit in 1 session');
  });

  it('says when nothing matches', async () => {
    mountWith([makeSessionText(1)]);
    await type('television');
    expect(status().text()).toBe('No matches');
    expect(results()).toHaveLength(0);
  });

  it('clears on Escape', async () => {
    mountWith([makeSessionText(1)]);
    await type('charger');
    await input().trigger('keydown', { key: 'Escape' });
    expect(input().element.value).toBe('');
    expect(results()).toHaveLength(0);
    expect(status().text()).toBe('');
  });

  it('clears the results as soon as the box is emptied', async () => {
    mountWith([makeSessionText(1)]);
    await type('charger');
    await input().setValue('');
    expect(results()).toHaveLength(0);
    expect(status().text()).toBe('');
  });

  it("shows a bad query's message under the box", async () => {
    mountWith([makeSessionText(1)]);
    await type('"charger');
    const error = wrapper!.get('.query-error');
    expect(error.text()).toBe('Close the quotation marks.');
    expect(input().attributes('aria-describedby')).toBe(error.attributes('id'));
    expect(input().attributes('aria-invalid')).toBe('true');
    expect(results()).toHaveLength(0);
  });

  it('loads the next sessions with More, and moves focus to the first new one', async () => {
    const texts = Array.from({ length: SEARCH_PAGE_SESSIONS + 3 }, (_, i) =>
      makeSessionText(i + 1),
    );
    mountWith(texts);
    await type('charger');
    expect(results()).toHaveLength(SEARCH_PAGE_SESSIONS);
    expect(status().text()).toBe(`23 hits in 23 sessions`);
    const more = wrapper!.findAll('button').find((b) => b.text() === 'More')!;
    await more.trigger('click');
    await flushPromises();
    expect(results()).toHaveLength(23);
    expect(wrapper!.findAll('button').some((b) => b.text() === 'More')).toBe(false);
    expect(document.activeElement).toBe(results()[SEARCH_PAGE_SESSIONS]!.get('h3').element);
  });

  it('focus() puts the cursor in the box', () => {
    mountWith([makeSessionText(1)]);
    (wrapper!.vm as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(input().element);
  });

  describe('when a rescan changes the sessions', () => {
    const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
    const announced = () => wrapper!.findAll('[aria-live="polite"]').map((p) => p.text());

    async function change(project: ReturnType<typeof useProjectStore>, texts: SessionText[]) {
      project.sessions = texts.map((t) => makeProjectSession(t));
      project.corpus = texts;
      await flushPromises();
    }

    it('keeps the results, with Update results in place of More, and says so', async () => {
      const texts = Array.from({ length: SEARCH_PAGE_SESSIONS + 3 }, (_, i) =>
        makeSessionText(i + 1),
      );
      const project = mountWith(texts);
      await type('charger');
      expect(button('More')).toBeDefined();
      expect(announced()).not.toContain(
        'The sessions have changed. Update results is at the end of the list.',
      );

      await change(project, [...texts, makeSessionText(SEARCH_PAGE_SESSIONS + 4)]);
      expect(results()).toHaveLength(SEARCH_PAGE_SESSIONS);
      expect(status().text()).toBe('23 hits in 23 sessions');
      expect(button('More')).toBeUndefined();
      expect(button('Update results')).toBeDefined();
      expect(announced()).toContain(
        'The sessions have changed. Update results is at the end of the list.',
      );
    });

    it('searches again from the first page with Update results, and focuses the first result', async () => {
      const project = mountWith([makeSessionText(1)]);
      await type('charger');
      await change(project, [makeSessionText(1), makeSessionText(2)]);
      expect(results()).toHaveLength(1);

      await button('Update results')!.trigger('click');
      await flushPromises();
      expect(results()).toHaveLength(2);
      expect(status().text()).toBe('2 hits in 2 sessions');
      expect(button('Update results')).toBeUndefined();
      expect(document.activeElement).toBe(results()[0]!.get('h3').element);
    });

    it('searches again at once when nothing matched', async () => {
      const project = mountWith([]);
      await type('charger');
      expect(status().text()).toBe('No matches');
      await change(project, [makeSessionText(1)]);
      expect(results()).toHaveLength(1);
      expect(button('Update results')).toBeUndefined();
    });

    it('drops Update results on a new search', async () => {
      const project = mountWith([makeSessionText(1)]);
      await type('charger');
      await change(project, [makeSessionText(1), makeSessionText(2)]);
      expect(button('Update results')).toBeDefined();
      await type('bed');
      expect(status().text()).toBe('2 hits in 2 sessions');
      expect(button('Update results')).toBeUndefined();
    });
  });

  it('copies the whole turn with its citation, and says Copied for a moment', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mountWith([makeSessionText(1)]);
    await type('charger');
    const copy = wrapper!.get('li.hit button');
    expect(copy.attributes('aria-label')).toBe('Copy, Anna at 00:01:01');
    await copy.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(
      '"I put them on the charger by the bed." — Anna, 00:01:01, P01 interview.m4a',
    );
    expect(copy.text()).toBe('Copied');
    expect(wrapper!.text()).toContain('Copied with its citation.');
    await vi.advanceTimersByTimeAsync(1600);
    expect(copy.text()).toBe('Copy');
  });

  describe('opening a hit', () => {
    const LONG = `I put them on the charger by the bed. ${Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')}, and the charger again.`;

    /** Session `n` with Anna's turn run on, so its snippet is only part of it. */
    function longSession(n: number): SessionText {
      const turns = makeSessionText(n).turns.map((t) => (t.id === 't2' ? { ...t, text: LONG } : t));
      return makeSessionText(n, { turns });
    }

    const hit = (i = 0) => wrapper!.findAll('li.hit')[i]!;
    const quote = (i = 0) => hit(i).get('.snippet');
    const toggle = (i = 0) => hit(i).get('button.hit-toggle');

    /** Clicks, and lets a quote that closes finish shrinking (happy-dom's animations only end when told to). */
    async function click(target: { trigger: (event: string) => Promise<void> }) {
      await target.trigger('click');
      await flushPromises();
      for (const el of wrapper!.element.querySelectorAll('.snippet')) {
        for (const animation of el.getAnimations({ subtree: true })) animation.finish();
      }
      await flushPromises();
    }

    it('shows the whole turn on a click anywhere on the hit, and the snippet again on a second', async () => {
      mountWith([longSession(1)]);
      await type('charger');
      expect(toggle().text().replace(/\s+/g, ' ')).toBe('Anna 00:01:01');
      expect(toggle().attributes('aria-expanded')).toBe('false');
      expect(toggle().attributes('aria-controls')).toBe(quote().attributes('id'));
      const snippet = quote().text();
      expect(snippet).toMatch(/…$/);

      await quote().trigger('click');
      await flushPromises();
      expect(toggle().attributes('aria-expanded')).toBe('true');
      expect(quote().classes()).toContain('open');
      expect(quote().text()).toBe(LONG);
      expect(
        quote()
          .findAll('mark')
          .map((m) => m.text()),
      ).toEqual(['charger', 'charger']);

      await click(hit().get('.hit-head'));
      expect(toggle().attributes('aria-expanded')).toBe('false');
      expect(quote().text()).toBe(snippet);
    });

    it("keeps the snippet's words, with the turn before them above and the rest in place of the …", async () => {
      const before = Array.from({ length: 30 }, (_, i) => `b${i}`).join(' ');
      const text = `${before} I put the charger by the bed, ${LONG}`;
      const turns = makeSessionText(1).turns.map((t) => (t.id === 't2' ? { ...t, text } : t));
      mountWith([makeSessionText(1, { turns })]);
      await type('bed');
      const words = quote().get('.words');
      const snippet = words.text();
      expect(snippet).toMatch(/^…b24 .*…$/);
      expect(quote().find('.before').exists()).toBe(false);

      await click(quote());
      // The same element: the words are left as they were, without the closing … .
      expect(quote().get('.words').element).toBe(words.element);
      expect(words.text()).toBe(snippet.slice(0, -1));
      const parts = ['.before', '.words', '.after'].map((c) => quote().get(c).element.textContent);
      expect(parts[0]).toBe(text.slice(0, text.indexOf('b24')));
      expect(parts.join('').replace('…', '')).toBe(text);

      await click(quote());
      expect(quote().get('.words').element).toBe(words.element);
      expect(words.text()).toBe(snippet);
      expect(quote().find('.after').exists()).toBe(false);
    });

    it('closes the open hit when another opens', async () => {
      mountWith([longSession(1), longSession(2)]);
      await type('charger');
      await click(toggle(0));
      await click(toggle(1));
      expect(toggle(0).attributes('aria-expanded')).toBe('false');
      expect(quote(0).text()).not.toBe(LONG);
      expect(toggle(1).attributes('aria-expanded')).toBe('true');
      expect(quote(1).text()).toBe(LONG);
    });

    it('stays as it is on Copy, or on a click that ends a selection', async () => {
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } });
      mountWith([longSession(1)]);
      await type('charger');
      await hit().get('button.copy').trigger('click');
      await flushPromises();
      expect(toggle().attributes('aria-expanded')).toBe('false');

      const selection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue({ isCollapsed: false } as Selection);
      await quote().trigger('click', { detail: 1 });
      await flushPromises();
      expect(toggle().attributes('aria-expanded')).toBe('false');
      selection.mockRestore();
    });

    it('has nothing to open when the snippet is the whole turn', async () => {
      mountWith([makeSessionText(1)]);
      await type('charger');
      expect(hit().find('button.hit-toggle').exists()).toBe(false);
      expect(hit().classes()).not.toContain('can-open');
      await quote().trigger('click');
      await flushPromises();
      expect(quote().classes()).not.toContain('open');
    });

    it('closes on a new search', async () => {
      mountWith([longSession(1)]);
      await type('charger');
      await toggle().trigger('click');
      await flushPromises();
      await type('bed');
      expect(toggle().attributes('aria-expanded')).toBe('false');
      expect(quote().text()).not.toBe(LONG);
    });
  });

  describe('showing all hits', () => {
    const LONG = `The charger ${Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')}.`;

    /** Session `n` with `count` turns about the charger, a minute apart. The sixth runs on, so it opens. */
    function manyHits(n: number, count: number): SessionText {
      const turns = Array.from({ length: count }, (_, i) => ({
        id: `t${i + 1}`,
        speakerId: 'speaker_1',
        start: 60 * (i + 1),
        text: i === 5 ? LONG : `The charger, number ${i + 1}.`,
        en: null,
      }));
      return makeSessionText(n, { turns });
    }

    const hits = () => wrapper!.findAll('li.hit');
    const button = () => wrapper!.get<HTMLButtonElement>('button.show-all');
    const times = () => hits().map((h) => h.get('.time').text());

    it('lists the first 4 hits, then all of them with Show all, focusing the first new one', async () => {
      mountWith([manyHits(1, 6)]);
      await type('charger');
      expect(times()).toEqual(['00:01:00', '00:02:00', '00:03:00', '00:04:00']);
      expect(button().text()).toBe('Show all');
      expect(button().attributes('aria-label')).toBe('Show all 6 hits in P01 interview.m4a');
      const first = hits()[0]!.element;

      await button().trigger('click');
      await flushPromises();
      expect(times()).toEqual([
        '00:01:00',
        '00:02:00',
        '00:03:00',
        '00:04:00',
        '00:05:00',
        '00:06:00',
      ]);
      // The first hits are left as they were.
      expect(hits()[0]!.element).toBe(first);
      expect(document.activeElement).toBe(hits()[4]!.get('button').element);
      expect(button().text()).toBe('Show fewer');
      expect(button().attributes('aria-label')).toBe('Show fewer hits in P01 interview.m4a');
    });

    it('lists the first 4 again with Show fewer, keeping focus on the button', async () => {
      mountWith([manyHits(1, 6)]);
      await type('charger');
      await button().trigger('click');
      await flushPromises();
      button().element.focus();
      await button().trigger('click');
      await flushPromises();
      expect(hits()).toHaveLength(4);
      expect(button().text()).toBe('Show all');
      expect(document.activeElement).toBe(button().element);
    });

    it('has no button when a session has 4 hits or fewer', async () => {
      mountWith([manyHits(1, 4)]);
      await type('charger');
      expect(hits()).toHaveLength(4);
      expect(wrapper!.find('button.show-all').exists()).toBe(false);
    });

    it('lists the first 4 again on a new search', async () => {
      mountWith([manyHits(1, 6)]);
      await type('charger');
      await button().trigger('click');
      await flushPromises();
      await type('the');
      expect(hits()).toHaveLength(4);
      expect(button().text()).toBe('Show all');
    });

    it('closes an open hit that Show fewer takes away', async () => {
      mountWith([manyHits(1, 6)]);
      await type('charger');
      await button().trigger('click');
      await flushPromises();
      const toggle = () => hits()[5]!.get('button.hit-toggle');
      await toggle().trigger('click');
      await flushPromises();
      expect(toggle().attributes('aria-expanded')).toBe('true');

      await button().trigger('click');
      await flushPromises();
      await button().trigger('click');
      await flushPromises();
      expect(toggle().attributes('aria-expanded')).toBe('false');
      expect(hits()[5]!.get('.snippet').classes()).not.toContain('open');
    });
  });

  it('shows the text selected for Ctrl+C when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      },
    });
    mountWith([makeSessionText(1)]);
    await type('charger');
    await wrapper!.get('li.hit button').trigger('click');
    await flushPromises();
    const area = wrapper!.get<HTMLTextAreaElement>('.copy-fallback textarea');
    expect(area.element.value).toContain('— Anna, 00:01:01, P01 interview.m4a');
    expect(document.activeElement).toBe(area.element);
  });
});

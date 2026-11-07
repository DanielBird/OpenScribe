import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuoteCard from './QuoteCard.vue';

const citation =
  '"I put them on the charger by the bed." — Anna, 00:41:12, P07 – home visit (translated from German)';

describe('QuoteCard', () => {
  let wrapper: VueWrapper | null = null;
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const verified = (props: Record<string, unknown> = {}) =>
    mount(QuoteCard, {
      props: {
        text: 'I put them on the charger by the bed.',
        check: 'verified',
        speaker: 'Anna',
        start: 2472,
        translatedFrom: 'deu',
        citation,
        ...props,
      },
      attachTo: document.body,
    });

  it("shows a verified quote in the transcript's words, who said it, when, and that it's translated", () => {
    wrapper = verified();
    expect(wrapper.get('blockquote').text()).toBe('“I put them on the charger by the bed.”');
    expect(wrapper.get('.source').text()).toBe('Anna · 00:41:12 · translated from German');
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      'Copy quote: I put them on the charger…',
    );
  });

  it('copies the quote with its citation, and says so for a moment', async () => {
    wrapper = verified();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(citation);
    expect(wrapper.get('button').text()).toBe('Copied');
    expect(wrapper.get('[aria-live]').text()).toBe('Copied with its citation.');
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.get('button').text()).toBe('Copy');
  });

  it('shows the text selected for Ctrl+C when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    wrapper = verified();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    const area = wrapper.get<HTMLTextAreaElement>('.copy-fallback textarea');
    expect(area.element.value).toBe(citation);
    expect(document.activeElement).toBe(area.element);
  });

  it('marks a quote that was not found, with no Copy', () => {
    wrapper = verified({ check: 'not_found', citation: null, translatedFrom: null });
    expect(wrapper.classes()).toContain('unverified');
    expect(wrapper.get('.flag').text()).toBe('Not found in the transcript');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('marks a quote whose left-out words could change it, with no Copy', () => {
    wrapper = verified({ check: 'unsafe_omission', citation: null, translatedFrom: null });
    expect(wrapper.classes()).toContain('unverified');
    expect(wrapper.get('.flag').text()).toBe('Left-out words may change the meaning');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('has no flag on a verified quote', () => {
    wrapper = verified();
    expect(wrapper.classes()).not.toContain('unverified');
    expect(wrapper.find('.flag').exists()).toBe(false);
  });

  it('leaves out the speaker and time when the turn is unknown', () => {
    wrapper = verified({
      check: 'not_found',
      citation: null,
      speaker: null,
      start: null,
      translatedFrom: null,
      sessionTitle: 'P07 – home visit',
    });
    expect(wrapper.get('.source').text()).toBe('P07 – home visit');
  });

  it('names a short quote whole on its Copy button', () => {
    wrapper = verified({ text: 'Every night.' });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Copy quote: Every night.');
  });

  it('names the session when asked to (chat answers)', () => {
    wrapper = verified({ sessionTitle: 'P07 – home visit', translatedFrom: null });
    expect(wrapper.get('.source').text()).toBe('Anna · 00:41:12 · P07 – home visit');
  });
});

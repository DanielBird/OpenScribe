import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAnswer } from '../../features/agent/answer';
import { makeAgentCorpus } from '../../testing/agentCorpus';
import AnswerBlocks from './AnswerBlocks.vue';
import QuoteCard from './QuoteCard.vue';

describe('AnswerBlocks', () => {
  let wrapper: VueWrapper | null = null;
  const corpus = makeAgentCorpus();

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const show = (text: string) => {
    wrapper = mount(AnswerBlocks, { props: { blocks: parseAnswer(text, corpus), corpus } });
    return wrapper;
  };

  it('renders paragraphs, headings, both kinds of list, bold and italic', () => {
    show(
      [
        '## Charging',
        '',
        'Most people charge **every night**, some *in the kitchen*.',
        '',
        '- by the bed',
        '- _with help_',
        '',
        '1. first',
        '2. second',
      ].join('\n'),
    );
    expect(wrapper!.get('h3').text()).toBe('Charging');
    expect(wrapper!.get('p strong').text()).toBe('every night');
    expect(wrapper!.get('p em').text()).toBe('in the kitchen');
    expect(wrapper!.findAll('ul li').map((li) => li.text())).toEqual(['by the bed', 'with help']);
    expect(wrapper!.get('ul li em').text()).toBe('with help');
    expect(wrapper!.findAll('ol li').map((li) => li.text())).toEqual(['first', 'second']);
  });

  it('shows text that looks like HTML as text, never as elements', () => {
    show('Try <script>alert(1)</script> and <b>bold</b> or <img src=x onerror=alert(1)>.');
    const p = wrapper!.get('p');
    expect(p.text()).toBe(
      'Try <script>alert(1)</script> and <b>bold</b> or <img src=x onerror=alert(1)>.',
    );
    expect(wrapper!.find('script').exists()).toBe(false);
    expect(wrapper!.find('b').exists()).toBe(false);
    expect(wrapper!.find('img').exists()).toBe(false);
  });

  it('shows a verified quote in the transcript’s words, with its session and Copy', () => {
    show('Mary said:\n<quote ref="s1/t2">i put them on the charger by the bed</quote>');
    const card = wrapper!.getComponent(QuoteCard);
    expect(card.props()).toMatchObject({
      text: 'I put them on the charger by the bed',
      verified: true,
      speaker: 'Mary',
      start: 61,
      sessionTitle: 'P01 – kitchen interview, Leeds',
      translatedFrom: null,
    });
    expect(card.props('citation')).toContain('— Mary, 00:01:01, P01 – kitchen interview, Leeds');
    expect(card.find('button').exists()).toBe(true);
  });

  it('says a translated quote is translated', () => {
    show('<quote ref="s2/t2">In the evening I put them on the charger.</quote>');
    expect(wrapper!.getComponent(QuoteCard).props('translatedFrom')).toBe('deu');
  });

  it('marks a quote that was not found, with its session when the ref is known', () => {
    show(
      '<quote ref="s1/t2">I charge them at the office</quote>\n<quote ref="s9/t1">Invented</quote>',
    );
    const [changed, unknown] = wrapper!.findAllComponents(QuoteCard);
    expect(changed!.props()).toMatchObject({
      text: 'I charge them at the office',
      verified: false,
      speaker: null,
      sessionTitle: 'P01 – kitchen interview, Leeds',
      citation: null,
    });
    expect(changed!.text()).toContain('Not found in the transcript');
    expect(changed!.find('button').exists()).toBe(false);
    expect(unknown!.props('sessionTitle')).toBeNull();
  });
});

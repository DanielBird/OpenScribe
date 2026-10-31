import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChatActivity as Activity } from '../../stores/chat';
import ChatActivity from './ChatActivity.vue';

const step = (tool: string, line: string, isError = false): Activity => ({ tool, line, isError });

describe('ChatActivity', () => {
  it('sums up the searches, reads and cost, collapsed, and opens to every line', () => {
    const wrapper = mount(ChatActivity, {
      props: {
        activity: [
          step('search_transcripts', 'Searched "charg*" · 23 hits in 9 sessions'),
          step('search_transcripts', 'Searched "night" · 4 hits in 2 sessions'),
          step('read_transcript', 'Read P07 – home visit 00:38:10–00:47:02'),
          step('get_summaries', 'Read the summaries of P01, P03'),
          step('list_themes', 'Listed the themes'),
          step('read_transcript', 'Unknown session s99', true),
        ],
        costUsd: 0.4012,
      },
    });
    const details = wrapper.get('details');
    expect(details.attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toBe('2 searches · 3 reads · ≈ $0.40');
    const lines = wrapper.findAll('li');
    expect(lines).toHaveLength(6);
    expect(lines[5]!.text()).toBe('Unknown session s99 (failed)');
    expect(lines[5]!.classes()).toContain('failed');
  });

  it('uses the singular, and shows a tiny cost as under a cent', () => {
    const wrapper = mount(ChatActivity, {
      props: { activity: [step('search_transcripts', 'Searched "x"')], costUsd: 0.004 },
    });
    expect(wrapper.get('summary').text()).toBe('1 search · < $0.01');
  });

  it('counts other steps when there were no searches or reads, and leaves out an unknown cost', () => {
    const wrapper = mount(ChatActivity, {
      props: { activity: [step('list_themes', 'Listed the themes')], costUsd: null },
    });
    expect(wrapper.get('summary').text()).toBe('1 step');
  });

  it('shows only the cost when no tool was used, and nothing at all without one', () => {
    const cost = mount(ChatActivity, { props: { activity: [], costUsd: 0.12 } });
    expect(cost.find('details').exists()).toBe(false);
    expect(cost.text()).toBe('≈ $0.12');
    const none = mount(ChatActivity, { props: { activity: [], costUsd: null } });
    expect(none.html()).toBe('<!--v-if-->');
  });
});

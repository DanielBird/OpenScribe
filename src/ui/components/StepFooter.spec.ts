import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import StepFooter from './StepFooter.vue';

const slots = {
  back: () => h('button', { type: 'button' }, 'Back'),
  primary: ({ describedBy }: { describedBy: string | undefined }) =>
    h('button', { type: 'button', 'aria-describedby': describedBy }, 'Run'),
};

describe('StepFooter', () => {
  it('renders the back and primary buttons, in that order', () => {
    const wrapper = mount(StepFooter, { slots });
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Back', 'Run']);
  });

  it('lists what is missing and links the list to the primary button', () => {
    const wrapper = mount(StepFooter, {
      props: { missing: ['Add your ElevenLabs API key in Settings.', 'Choose a recording.'] },
      slots,
    });
    const run = wrapper.findAll('button').find((b) => b.text() === 'Run')!;
    const list = wrapper.get(`#${run.attributes('aria-describedby')}`);
    expect(list.element.tagName).toBe('UL');
    expect(list.findAll('li').map((li) => li.text())).toEqual([
      'Add your ElevenLabs API key in Settings.',
      'Choose a recording.',
    ]);
  });

  it('has no list and no description when nothing is missing', () => {
    const wrapper = mount(StepFooter, { props: { missing: [] }, slots });
    expect(wrapper.find('ul').exists()).toBe(false);
    const run = wrapper.findAll('button').find((b) => b.text() === 'Run')!;
    expect(run.attributes('aria-describedby')).toBeUndefined();
  });

  it('works without a back button', () => {
    const wrapper = mount(StepFooter, { slots: { primary: slots.primary } });
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Run']);
  });
});

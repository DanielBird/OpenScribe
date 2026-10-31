import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ChatInput from './ChatInput.vue';

describe('ChatInput', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const show = (running = false) => {
    wrapper = mount(ChatInput, { props: { running }, attachTo: document.body });
    return wrapper;
  };
  const box = () => wrapper!.get('textarea');

  it('has a labelled box with the placeholder, and Send', () => {
    show();
    const id = box().attributes('id');
    expect(wrapper!.get(`label[for="${id}"]`).text()).toBe('Question');
    expect(box().attributes('placeholder')).toBe('Ask about the project…');
    expect(wrapper!.get('button').attributes('aria-label')).toBe('Send');
  });

  it('Enter sends the trimmed question and empties the box', async () => {
    show();
    await box().setValue('  Who charges at night?  ');
    await box().trigger('keydown', { key: 'Enter' });
    expect(wrapper!.emitted('send')).toEqual([['Who charges at night?']]);
    expect((box().element as HTMLTextAreaElement).value).toBe('');
  });

  it('Shift+Enter is a new line, and Enter during IME composition does nothing', async () => {
    show();
    await box().setValue('One');
    await box().trigger('keydown', { key: 'Enter', shiftKey: true });
    await box().trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper!.emitted('send')).toBeUndefined();
  });

  it('Send sends; an empty box sends nothing', async () => {
    show();
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.emitted('send')).toBeUndefined();
    await box().setValue('Two');
    await wrapper!.get('button').trigger('click');
    await wrapper!.get('form').trigger('submit');
    expect(wrapper!.emitted('send')).toEqual([['Two']]);
  });

  it('while an answer runs, the box stays usable, Enter waits, and Stop stops', async () => {
    show(true);
    expect(box().attributes('disabled')).toBeUndefined();
    await box().setValue('Next question');
    await box().trigger('keydown', { key: 'Enter' });
    expect(wrapper!.emitted('send')).toBeUndefined();
    expect((box().element as HTMLTextAreaElement).value).toBe('Next question');

    const stop = wrapper!.get('button');
    expect(stop.attributes('aria-label')).toBe('Stop');
    expect(stop.attributes('type')).toBe('button');
    await stop.trigger('click');
    expect(wrapper!.emitted('stop')).toHaveLength(1);

    await wrapper!.setProps({ running: false });
    await box().trigger('keydown', { key: 'Enter' });
    expect(wrapper!.emitted('send')).toEqual([['Next question']]);
  });

  it('focus() puts focus in the box', () => {
    show();
    (wrapper!.vm as unknown as { focus(): void }).focus();
    expect(document.activeElement).toBe(box().element);
  });
});

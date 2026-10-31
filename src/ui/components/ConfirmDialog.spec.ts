import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { useConfirm, type ConfirmOptions } from '../composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';

/** A component that owns a ConfirmDialog via useConfirm, plus a button that triggers it. */
const Harness = defineComponent({
  setup(_, { expose }) {
    const { confirm, dialog } = useConfirm();
    expose({ confirm });
    return () =>
      h('div', [
        h('button', { type: 'button', class: 'trigger' }, 'Remove all'),
        h(ConfirmDialog, dialog.value),
      ]);
  },
});

type HarnessVm = { confirm: (o: ConfirmOptions) => Promise<boolean> };

const OPTIONS: ConfirmOptions = {
  title: 'Clear the glossary?',
  message: "Remove all 3 terms? This can't be undone.",
  confirmLabel: 'Remove all',
  danger: true,
};

describe('ConfirmDialog with useConfirm', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  /** Mounts the harness, focuses the trigger and opens a confirmation. */
  async function open(options: ConfirmOptions = OPTIONS) {
    wrapper = mount(Harness, { attachTo: document.body });
    const trigger = wrapper.get<HTMLButtonElement>('.trigger').element;
    trigger.focus();
    const result = (wrapper.vm as unknown as HarnessVm).confirm(options);
    await flushPromises();
    return { result, trigger, dialog: wrapper.get<HTMLDialogElement>('dialog') };
  }

  const buttonNamed = (name: string) =>
    wrapper!
      .get('dialog')
      .findAll('button')
      .find((b) => b.text() === name)!;

  it('starts closed', () => {
    wrapper = mount(Harness, { attachTo: document.body });
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
  });

  it('opens as a labelled modal with the title, message and buttons', async () => {
    const { dialog } = await open();
    expect(dialog.element.open).toBe(true);
    expect(dialog.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe(
      'Clear the glossary?',
    );
    expect(dialog.get(`#${dialog.attributes('aria-describedby')}`).text()).toBe(
      "Remove all 3 terms? This can't be undone.",
    );
    expect(dialog.findAll('button').map((b) => b.text())).toEqual(['Cancel', 'Remove all']);
    expect(buttonNamed('Remove all').classes()).toContain('button-danger');
  });

  it('focuses Cancel for a danger confirmation and the confirm button otherwise', async () => {
    await open();
    expect(document.activeElement).toBe(buttonNamed('Cancel').element);
    wrapper!.unmount();

    await open({ ...OPTIONS, danger: false, confirmLabel: 'Start' });
    expect(document.activeElement).toBe(buttonNamed('Start').element);
    expect(buttonNamed('Start').classes()).toContain('button-primary');
  });

  it('resolves true on confirm, closes and returns focus to the trigger', async () => {
    const { result, trigger, dialog } = await open();
    await buttonNamed('Remove all').trigger('click');
    await expect(result).resolves.toBe(true);
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves false on Cancel and returns focus to the trigger', async () => {
    const { result, trigger, dialog } = await open();
    await buttonNamed('Cancel').trigger('click');
    await expect(result).resolves.toBe(false);
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves false on Escape (the cancel event) and closes itself', async () => {
    const { result, trigger, dialog } = await open();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.element.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await expect(result).resolves.toBe(false);
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves false when the browser closes the dialog itself', async () => {
    const { result, dialog } = await open();
    dialog.element.close();
    await expect(result).resolves.toBe(false);
  });

  it('resolves a pending confirmation with false when a new one starts', async () => {
    const { result } = await open();
    const second = (wrapper!.vm as unknown as HarnessVm).confirm({
      ...OPTIONS,
      title: 'Second',
    });
    await expect(result).resolves.toBe(false);
    await flushPromises();
    expect(wrapper!.get('dialog').element.open).toBe(true);
    expect(wrapper!.get('dialog h2').text()).toBe('Second');

    await buttonNamed('Remove all').trigger('click');
    await expect(second).resolves.toBe(true);
  });

  it('resolves false when the owner unmounts', async () => {
    const { result } = await open();
    wrapper!.unmount();
    wrapper = null;
    await expect(result).resolves.toBe(false);
  });
});

describe('ConfirmDialog with slot content', () => {
  it('shows the slot below the title and leaves out an empty message', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: 'Which version?', confirmLabel: 'Download' },
      slots: { default: '<fieldset class="choice">Original</fieldset>' },
      attachTo: document.body,
    });
    await flushPromises();
    const dialog = wrapper.get('dialog');
    expect(dialog.find('.choice').text()).toBe('Original');
    expect(dialog.find('p').exists()).toBe(false);
    expect(dialog.attributes('aria-describedby')).toBeUndefined();
    expect(dialog.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Which version?');
    wrapper.unmount();
  });

  it('can disable the confirm button', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: 'Translate', confirmLabel: 'Translate', confirmDisabled: true },
      attachTo: document.body,
    });
    await flushPromises();
    const confirm = () => wrapper.findAll('button').find((b) => b.text() === 'Translate')!;
    expect(confirm().attributes('disabled')).toBeDefined();
    await wrapper.setProps({ confirmDisabled: false });
    expect(confirm().attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});

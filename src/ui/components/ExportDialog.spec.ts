import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import ExportDialog from './ExportDialog.vue';

describe('ExportDialog', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  async function mountOpen(initial: 'original' | 'en' = 'original') {
    wrapper = mount(ExportDialog, {
      props: { open: false, language: 'German', initial },
      attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    return wrapper;
  }

  const radio = (value: string) => wrapper!.get<HTMLInputElement>(`input[value="${value}"]`);
  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name)!;

  it('offers the original and the English translation, starting on the initial version', async () => {
    await mountOpen();
    const dialog = wrapper!.get('dialog');
    expect(dialog.element.open).toBe(true);
    expect(dialog.get('h2').text()).toBe('Which version?');
    expect(dialog.findAll('label').map((l) => l.text())).toEqual([
      'Original (German)',
      'English translation',
    ]);
    expect(radio('original').element.checked).toBe(true);
    expect(dialog.get('legend').text()).toBe('Version');
    expect(document.activeElement).toBe(button('Download').element);
  });

  it('emits the chosen version on Download', async () => {
    await mountOpen();
    await radio('en').setValue(true);
    await button('Download').trigger('click');
    expect(wrapper!.emitted('download')).toEqual([['en']]);
  });

  it('emits cancel on Cancel', async () => {
    await mountOpen('en');
    await button('Cancel').trigger('click');
    expect(wrapper!.emitted('cancel')).toHaveLength(1);
    expect(wrapper!.emitted('download')).toBeUndefined();
  });

  it('starts again from the initial version each time it opens', async () => {
    await mountOpen('en');
    expect(radio('en').element.checked).toBe(true);
    await radio('original').setValue(true);
    await wrapper!.setProps({ open: false });
    await wrapper!.setProps({ open: true });
    await flushPromises();
    expect(radio('en').element.checked).toBe(true);
  });
});

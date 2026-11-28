import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_ERROR, useExportStore } from '../../stores/export';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc, withSourceHashes, withTranslation } from '../../testing/transcriptDoc';
import ExportButton from './ExportButton.vue';
import ExportDialog from './ExportDialog.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('ExportButton', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useTranscriptStore().$dispose();
  });

  async function setup(doc = makeDoc()) {
    await useTranscriptStore().setDoc(doc);
    const store = useExportStore();
    const download = vi.spyOn(store, 'download').mockResolvedValue();
    wrapper = mount(ExportButton, { attachTo: document.body });
    return { store, download, button: wrapper.get('button') };
  }

  const dialogOpen = () => wrapper!.get<HTMLDialogElement>('dialog').element.open;

  it('downloads the original at once when there is no translation', async () => {
    const { download, button } = await setup();
    expect(button.text()).toBe('Download .docx');
    await button.trigger('click');
    expect(download).toHaveBeenCalledExactlyOnceWith('original');
    expect(dialogOpen()).toBe(false);
  });

  it('tells the dialog how many turns of the English are out of date (D39)', async () => {
    const { button } = await setup(withSourceHashes(withTranslation(makeDoc())));
    useTranscriptStore().editTurnText('t3', 'Wie lange?');
    await button.trigger('click');
    await flushPromises();
    expect(wrapper!.getComponent(ExportDialog).props('stale')).toBe(1);
  });

  it('asks which version when a translation exists, defaulting to the view', async () => {
    const { download, button } = await setup(withTranslation(makeDoc()));
    useTranscriptStore().view = 'en';
    await button.trigger('click');
    await flushPromises();
    expect(dialogOpen()).toBe(true);
    const dialog = wrapper!.getComponent(ExportDialog);
    expect(dialog.props()).toMatchObject({ language: 'German', initial: 'en', stale: 0 });

    dialog.vm.$emit('download', 'en');
    await flushPromises();
    expect(download).toHaveBeenCalledExactlyOnceWith('en');
    expect(dialogOpen()).toBe(false);
  });

  it('closes the dialog without downloading on cancel', async () => {
    const { download, button } = await setup(withTranslation(makeDoc()));
    await button.trigger('click');
    await flushPromises();
    wrapper!.getComponent(ExportDialog).vm.$emit('cancel');
    await flushPromises();
    expect(dialogOpen()).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it('shows a spinner while busy, stays focusable and ignores clicks', async () => {
    const { store, download, button } = await setup();
    store.busy = true;
    await flushPromises();
    expect(button.find('.spinner').exists()).toBe(true);
    expect(button.attributes('aria-disabled')).toBe('true');
    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(download).not.toHaveBeenCalled();

    store.busy = false;
    await flushPromises();
    expect(button.find('.spinner').exists()).toBe(false);
    expect(button.attributes('aria-disabled')).toBeUndefined();
  });

  it('shows an error inline', async () => {
    const { store } = await setup();
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
    store.error = EXPORT_ERROR;
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toBe(EXPORT_ERROR);
  });

  describe('in the desktop app (D61)', () => {
    beforeEach(() => vi.stubGlobal('__DESKTOP__', true));
    afterEach(() => vi.unstubAllGlobals());

    it('is named Save as .docx, and the version dialog says Save', async () => {
      const { button } = await setup(withTranslation(makeDoc()));
      expect(button.attributes('aria-label')).toBe('Save as .docx');
      expect(button.get('.icon-tip').text()).toBe('Save as .docx');
      expect(wrapper!.getComponent(ExportDialog).text()).toContain('Save');
      expect(wrapper!.getComponent(ExportDialog).text()).not.toContain('Download');
    });

    it('shows a tick, and tells screen readers the file name', async () => {
      const { store, button } = await setup();
      const status = () => wrapper!.get('[role="status"]').text();
      expect(status()).toBe('');

      store.saved = 'interview - transcript (German).docx';
      await flushPromises();
      expect(button.classes()).toContain('saved');
      expect(button.get('svg path').attributes('d')).toBe('M5 12.5 9.5 17 19 7');
      expect(button.get('.icon-tip').text()).toBe('Save as .docx');
      expect(button.attributes('aria-label')).toBe('Save as .docx');
      expect(status()).toBe('Saved interview - transcript (German).docx');

      store.saved = null;
      await flushPromises();
      expect(button.classes()).not.toContain('saved');
      expect(status()).toBe('');
    });
  });
});

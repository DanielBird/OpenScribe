import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import { makeDoc, withSourceHashes, withTranslation } from '../../testing/transcriptDoc';
import TranslateButton from './TranslateButton.vue';
import TranslateDialog from './TranslateDialog.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('TranslateButton', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useTranscriptStore().$dispose();
  });

  /** Mounts with `doc`; the store's actions are spies that only change the status. */
  async function setup(doc = makeDoc()) {
    await useTranscriptStore().setDoc(doc);
    const store = useTranslationStore();
    const start = vi.spyOn(store, 'start').mockImplementation(() => {
      store.status = 'running';
      return Promise.resolve();
    });
    const cancel = vi.spyOn(store, 'cancel').mockImplementation(() => {
      store.status = 'cancelled';
    });
    const resume = vi.spyOn(store, 'resume').mockImplementation(() => {
      store.status = 'running';
      return Promise.resolve();
    });
    wrapper = mount(TranslateButton, { attachTo: document.body });
    return { store, start, cancel, resume };
  }

  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name);
  const liveText = () => wrapper!.get('[role="status"]').text();

  it('opens the dialog and starts with the chosen provider and model', async () => {
    const { start } = await setup();
    const translate = button('Translate to English')!;
    await translate.trigger('click');
    await flushPromises();
    expect(wrapper!.get<HTMLDialogElement>('dialog').element.open).toBe(true);

    wrapper!.getComponent(TranslateDialog).vm.$emit('translate', 'gemini', 'gemini-3.8-flash');
    await flushPromises();
    expect(start).toHaveBeenCalledExactlyOnceWith('gemini', 'gemini-3.8-flash');
    expect(wrapper!.get<HTMLDialogElement>('dialog').element.open).toBe(false);
  });

  it('reads Re-translate… when a translation exists', async () => {
    await setup(withTranslation(makeDoc()));
    expect(button('Re-translate…')).toBeDefined();
    expect(wrapper!.getComponent(TranslateDialog).props('mode')).toBe('replace');
  });

  it('reads Update English… once a turn changed since the translation (D39)', async () => {
    await setup(withSourceHashes(withTranslation(makeDoc())));
    useTranscriptStore().editTurnText('t2', 'Danke.');
    useTranscriptStore().editTurnText('t4', 'Zwei Jahre.');
    await flushPromises();
    expect(button('Update English…')).toBeDefined();
    expect(button('Re-translate…')).toBeUndefined();
    const dialog = wrapper!.getComponent(TranslateDialog);
    expect(dialog.props('mode')).toBe('update');
    expect(dialog.props('changed')).toBe(2);
  });

  it.each([
    ['an English transcript', { result: { ...makeDoc().result, languageCode: 'eng' } }],
    ['a transcript without speech', { speakers: [], turns: [] }],
  ])('is not shown for %s', async (_, overrides) => {
    await setup(makeDoc(overrides));
    expect(wrapper!.find('.translate').exists()).toBe(false);
  });

  it('shows the progress with Cancel instead of the button while running', async () => {
    const { store, cancel } = await setup();
    store.status = 'running';
    await flushPromises();
    expect(button('Translate to English')).toBeUndefined();
    expect(wrapper!.get('.status-line').text()).toBe('Translating…');
    expect(wrapper!.find('progress').exists()).toBe(false); // a single batch
    expect(liveText()).toBe('Translating');

    store.progress = { batch: 3, totalBatches: 12 };
    await flushPromises();
    expect(wrapper!.get('.status-line').text()).toBe('Translating… batch 3 of 12');
    const progress = wrapper!.get('progress');
    expect(progress.attributes('aria-label')).toBe('Translation progress');
    expect(progress.attributes('value')).toBe('2');
    expect(progress.attributes('max')).toBe('12');

    await button('Cancel')!.trigger('click');
    expect(cancel).toHaveBeenCalledOnce();
    await flushPromises();
    expect(liveText()).toBe('Translation cancelled.');
    expect(button('Translate to English')).toBeDefined();
  });

  it('shows an error with Resume', async () => {
    const { store, resume } = await setup();
    store.error = new ProviderError('rate_limit', 'Claude is busy.');
    store.status = 'error';
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toBe('Claude is busy.');
    expect(button('Translate to English')).toBeDefined(); // or start over
    await button('Resume')!.trigger('click');
    expect(resume).toHaveBeenCalledOnce();
  });

  it('shows the technical details of an error', async () => {
    const { store } = await setup();
    store.error = new ProviderError('bad_output', 'Claude sent a reply DeScribe could not read.', {
      detail: 'batch 2: missing id t61',
    });
    store.status = 'error';
    await flushPromises();
    expect(wrapper!.get('.failed details pre').text()).toContain(
      'bad_output\nbatch 2: missing id t61',
    );
  });

  it('announces a finished translation', async () => {
    const { store } = await setup();
    store.status = 'running';
    await flushPromises();
    const transcript = useTranscriptStore();
    await transcript.setTranslation(
      transcript.doc!.id,
      withTranslation(makeDoc()).translations.en!,
    );
    store.status = 'idle';
    await flushPromises();
    expect(liveText()).toBe('English translation ready.');
    expect(button('Re-translate…')).toBeDefined();
  });

  it('moves focus to the button when Cancel disappears, and to Resume on an error', async () => {
    const { store } = await setup();
    store.status = 'running';
    await flushPromises();
    const cancel = button('Cancel')!;
    (cancel.element as HTMLButtonElement).focus();
    await cancel.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(button('Translate to English')!.element);

    store.status = 'running';
    await flushPromises();
    (button('Cancel')!.element as HTMLButtonElement).focus();
    store.error = new ProviderError('server', 'Down.');
    store.status = 'error';
    await flushPromises();
    expect(document.activeElement).toBe(button('Resume')!.element);
  });

  it('moves focus to the progress line after the dialog starts a translation', async () => {
    await setup();
    await button('Translate to English')!.trigger('click');
    await flushPromises();
    wrapper!.getComponent(TranslateDialog).vm.$emit('translate', 'claude', 'claude-opus-5-5');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper!.get('.status-line').element);
  });
});

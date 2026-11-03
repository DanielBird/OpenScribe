import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc, withTranslation } from '../../testing/transcriptDoc';
import VersionToggle from './VersionToggle.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('VersionToggle', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useTranscriptStore().$dispose();
  });

  const buttons = () => wrapper!.findAll('button');
  const pressed = () => buttons().map((b) => b.attributes('aria-pressed'));

  it('is not shown until a translation exists', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    wrapper = mount(VersionToggle);
    expect(wrapper.find('[role="group"]').exists()).toBe(false);
  });

  it('says only "Original" when the language is not known', async () => {
    const doc = withTranslation(makeDoc());
    await useTranscriptStore().setDoc({ ...doc, result: { ...doc.result, languageCode: '' } });
    wrapper = mount(VersionToggle);
    expect(buttons().map((b) => b.text())).toEqual(['Original', 'English']);
  });

  it('switches between the original and English', async () => {
    const transcript = useTranscriptStore();
    await transcript.setDoc(withTranslation(makeDoc()));
    wrapper = mount(VersionToggle);

    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Version');
    expect(buttons().map((b) => b.text())).toEqual(['Original (German)', 'English']);
    expect(pressed()).toEqual(['true', 'false']);

    await buttons()[1]!.trigger('click');
    expect(transcript.view).toBe('en');
    expect(pressed()).toEqual(['false', 'true']);

    await buttons()[0]!.trigger('click');
    expect(transcript.view).toBe('original');
    expect(pressed()).toEqual(['true', 'false']);
  });
});

import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { makeDoc } from '../../testing/transcriptDoc';
import SpeakerPanel from './SpeakerPanel.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
}));

describe('SpeakerPanel', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(async () => {
    setActivePinia(createPinia());
    await useTranscriptStore().setDoc(makeDoc());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    useTranscriptStore().$dispose();
  });

  const inputs = () => wrapper!.findAll('input');
  const labels = () => useTranscriptStore().doc!.speakers.map((s) => s.label);

  it('lists each speaker with a labelled, empty field and the number of turns', () => {
    wrapper = mount(SpeakerPanel);
    expect(wrapper.get('summary').text()).toBe('Speakers');
    expect(inputs()).toHaveLength(2);
    expect(inputs().map((i) => i.element.value)).toEqual(['', '']);
    expect(inputs().map((i) => i.attributes('placeholder'))).toEqual(['Speaker 1', 'Speaker 2']);
    const label = wrapper.get(`label[for="${inputs()[0]!.attributes('id')}"]`);
    expect(label.text()).toBe('Name for Speaker 1');
    expect(wrapper.findAll('.count').map((c) => c.text())).toEqual(['3 turns', '2 turns']);
  });

  it('starts open while every speaker has the default name', () => {
    wrapper = mount(SpeakerPanel);
    expect(wrapper.get('details').attributes('open')).toBeDefined();
  });

  it('starts collapsed when a speaker has been named', () => {
    useTranscriptStore().renameSpeaker(useTranscriptStore().doc!.speakers[1]!.id, 'Guest');
    wrapper = mount(SpeakerPanel);
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
  });

  it('stays open while a speaker is being named', async () => {
    wrapper = mount(SpeakerPanel);
    await inputs()[0]!.setValue('Dr Weber');
    expect(wrapper.get('details').attributes('open')).toBeDefined();
  });

  it('renames on every keystroke and keeps exactly what was typed', async () => {
    wrapper = mount(SpeakerPanel);
    const first = inputs()[0]!;
    await first.trigger('focus');
    await first.setValue('Dr ');
    expect(labels()).toEqual(['Dr', 'Speaker 2']);
    expect(first.element.value).toBe('Dr '); // the store trims; the field doesn't

    await first.setValue('Dr Weber');
    expect(labels()).toEqual(['Dr Weber', 'Speaker 2']);
  });

  it('clearing a name restores the default without filling the field', async () => {
    wrapper = mount(SpeakerPanel);
    const second = inputs()[1]!;
    await second.trigger('focus');
    await second.setValue('Guest');
    await second.setValue('');
    expect(labels()).toEqual(['Speaker 1', 'Speaker 2']);
    expect(second.element.value).toBe('');
    await second.trigger('blur');
    expect(second.element.value).toBe('');
  });

  it('shows a saved name after blur', async () => {
    useTranscriptStore().renameSpeaker('speaker_1', 'Guest');
    wrapper = mount(SpeakerPanel);
    expect(inputs()[1]!.element.value).toBe('Guest');
  });
});

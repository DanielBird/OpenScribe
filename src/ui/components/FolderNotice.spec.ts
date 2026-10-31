import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLDER_MESSAGES, FolderError } from '../../storage/folder';
import { useTranscriptStore } from '../../stores/transcript';
import FolderNotice from './FolderNotice.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  saveTranscriptLink: vi.fn(() => Promise.resolve(true)),
}));

describe('FolderNotice', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
  });

  function linked() {
    const transcript = useTranscriptStore();
    transcript.projectLink = {
      docId: 'doc',
      projectId: 'p',
      projectName: 'Hearing at home 2026',
      fileName: 'x.transcript.json',
      stat: { size: 1, lastModified: 1 },
    };
    return transcript;
  }

  const button = (name: string) => wrapper!.findAll('button').find((b) => b.text() === name)!;

  it('shows nothing while saving to the folder works', () => {
    linked();
    wrapper = mount(FolderNotice);
    expect(wrapper.find('.folder-notice').exists()).toBe(false);
  });

  it('a conflict: Reload or Keep mine', async () => {
    const transcript = linked();
    transcript.folderConflict = true;
    const resolve = vi.spyOn(transcript, 'resolveConflict').mockResolvedValue(undefined);
    wrapper = mount(FolderNotice);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "The project's copy of this transcript has changed.",
    );
    await button('Reload').trigger('click');
    await flushPromises();
    expect(resolve).toHaveBeenLastCalledWith('reload');
    await button('Keep mine').trigger('click');
    await flushPromises();
    expect(resolve).toHaveBeenLastCalledWith('keep');
  });

  it('lost access: Reconnect', async () => {
    const transcript = linked();
    transcript.folderSaveError = new FolderError('permission', FOLDER_MESSAGES.permission);
    const reconnect = vi.spyOn(transcript, 'reconnectFolder').mockResolvedValue(undefined);
    wrapper = mount(FolderNotice);
    expect(wrapper.text()).toContain('DeScribe no longer has access to “Hearing at home 2026”.');
    await button('Reconnect').trigger('click');
    expect(reconnect).toHaveBeenCalled();
  });

  it('another failure: its message, and Try again', async () => {
    const transcript = linked();
    transcript.folderSaveError = new FolderError(
      'io',
      "DeScribe couldn't save this file. Try again.",
    );
    const retry = vi.spyOn(transcript, 'retryFolderSave').mockResolvedValue(undefined);
    wrapper = mount(FolderNotice);
    expect(wrapper.text()).toContain("DeScribe couldn't save this file. Try again.");
    await button('Try again').trigger('click');
    expect(retry).toHaveBeenCalled();
  });

  it('another project is open: says which one to open', async () => {
    const transcript = linked();
    transcript.folderSaveError = null;
    // `otherProject` is internal: reach it through a save while another project is open.
    vi.spyOn(transcript, 'folderNotice', 'get').mockReturnValue({
      kind: 'otherProject',
      projectName: 'Hearing at home 2026',
    });
    wrapper = mount(FolderNotice);
    expect(wrapper.text()).toContain('Open “Hearing at home 2026” in Analyse mode');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

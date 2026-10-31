import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toSessionText } from '../../domain/corpus/sessionText';
import { ProviderError } from '../../providers/errors';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { usePlaybackStore } from '../../stores/playback';
import { useProjectStore } from '../../stores/project';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import { makeProjectFile, makeSummaryFile } from '../../testing/projectSeed';
import { makeProjectSession } from '../../testing/projectSessions';
import { makeDoc, TEST_TRANSLATION_TEXTS, withTranslation } from '../../testing/transcriptDoc';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import AudioBar from '../components/AudioBar.vue';
import ExportButton from '../components/ExportButton.vue';
import JobStatus from '../components/JobStatus.vue';
import SpeakerPanel from '../components/SpeakerPanel.vue';
import TranslateButton from '../components/TranslateButton.vue';
import TurnList from '../components/TurnList.vue';
import VersionToggle from '../components/VersionToggle.vue';
import OutputView from './OutputView.vue';

vi.mock('../../storage/idb', () => ({
  saveLastTranscript: vi.fn(() => Promise.resolve(true)),
  loadLastTranscript: vi.fn(() => Promise.resolve(null)),
  saveTranscriptLink: vi.fn(() => Promise.resolve(true)),
}));

describe('OutputView', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    usePlaybackStore().$dispose();
    useTranscriptStore().$dispose();
    vi.restoreAllMocks();
  });

  const footer = () => wrapper!.find('[data-testid="step-footer"]');
  const showsTranscript = () => wrapper!.findComponent(TurnList).exists();

  it('keeps the hidden h1 that takes focus on step change', () => {
    wrapper = mount(OutputView);
    const h1 = wrapper.get('h1');
    expect(h1.text()).toBe('Output');
    expect(h1.classes()).toContain('visually-hidden');
    expect(h1.attributes('tabindex')).toBe('-1');
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(h1.attributes('id'));
  });

  it('shows the empty state without a doc or a run', () => {
    wrapper = mount(OutputView);
    expect(wrapper.text()).toContain('No transcript yet. Start on the Setup tab.');
    expect(footer().exists()).toBe(false);
  });

  it('shows the transcript: header, speakers and turns', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    useJobStore().status = 'done';
    wrapper = mount(OutputView);
    expect(wrapper.get('h2').text()).toBe('interview.mp3');
    expect(wrapper.findComponent(SpeakerPanel).exists()).toBe(true);
    expect(wrapper.findAll('li.turn')).toHaveLength(5);
    expect(wrapper.findComponent(JobStatus).exists()).toBe(false);
    expect(footer().exists()).toBe(false);
  });

  it('offers the download, the translation and the version switch in the actions row', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    wrapper = mount(OutputView);
    const actions = wrapper.get('.actions');
    expect(actions.findComponent(ExportButton).exists()).toBe(true);
    expect(actions.findComponent(TranslateButton).exists()).toBe(true);
    expect(actions.findComponent(VersionToggle).exists()).toBe(true);
  });

  describe('Open summary', () => {
    /** The transcript on Output, in the open project, with or without its summary. */
    async function inProject(withSummary: boolean) {
      const doc = makeDoc();
      const transcript = useTranscriptStore();
      await transcript.setDoc(doc);
      const project = useProjectStore();
      project.status = 'ready';
      project.project = makeProjectFile();
      const session = makeProjectSession(
        toSessionText(doc),
        [],
        withSummary ? { file: makeSummaryFile(doc) } : null,
      );
      project.sessions = [session];
      transcript.linkToProject(session.transcriptFile.name, session.transcriptFile.stat);
      return doc;
    }

    const openSummary = () =>
      wrapper!.findAll('.actions button').find((b) => b.text() === 'Open summary');

    afterEach(() => resetProjectUi());

    it("shows the session's summary in Analyse mode, in place of the chat", async () => {
      const doc = await inProject(true);
      wrapper = mount(OutputView);
      expect(wrapper.findAll('.actions button').map((b) => b.text())).not.toContain(
        'Add to project…',
      );
      await openSummary()!.trigger('click');
      expect(useNavStore().mode).toBe('project');
      expect(useProjectUi().selected).toBe(doc.id);
    });

    it('is not offered before the summary is made, nor for a transcript in no project', async () => {
      await inProject(false);
      wrapper = mount(OutputView);
      expect(openSummary()).toBeUndefined();
      wrapper.unmount();

      await useTranscriptStore().setDoc(makeDoc({ id: 'other' }));
      wrapper = mount(OutputView);
      expect(openSummary()).toBeUndefined();
    });
  });

  it('orders Edit text, Download .docx, then Add to project, which is the primary button', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    useProjectStore().status = 'none';
    wrapper = mount(OutputView);
    // The row's own buttons, not those of its (closed) dialogs.
    const buttons = wrapper
      .get('.actions')
      .findAll('button')
      .filter((b) => !b.element.closest('dialog'));
    const names = buttons.map((b) => b.text());
    const at = (name: string) => names.indexOf(name);
    expect(at('Edit text')).toBe(0);
    expect(at('Download .docx')).toBeGreaterThan(at('Edit text'));
    expect(at('Add to project…')).toBe(at('Download .docx') + 1);
    expect(buttons.filter((b) => b.classes('button-primary')).map((b) => b.text())).toEqual([
      'Add to project…',
    ]);
  });

  it('shows the English texts when the view is English, and the original otherwise', async () => {
    const transcript = useTranscriptStore();
    await transcript.setDoc(withTranslation(makeDoc()));
    wrapper = mount(OutputView);
    const list = () => wrapper!.getComponent(TurnList);
    expect(list().props('texts')).toBeUndefined();
    expect(list().props('lang')).toBe('de');

    transcript.view = 'en';
    await flushPromises();
    expect(list().props('texts')).toEqual(TEST_TRANSLATION_TEXTS);
    expect(list().props('lang')).toBe('en');
    expect(wrapper.findAll('li.turn .text')[0]?.text()).toBe(TEST_TRANSLATION_TEXTS.t1);
  });

  describe('Edit text', () => {
    const editButton = () =>
      wrapper!.findAll('.actions button').find((b) => ['Edit text', 'Done'].includes(b.text()));
    // The last live region in the row; Translate has its own.
    const announcement = () => wrapper!.findAll('.actions [role="status"]').at(-1)?.text();

    it('comes first in the actions row and turns the turns into boxes, showing the Original', async () => {
      const transcript = useTranscriptStore();
      await transcript.setDoc(withTranslation(makeDoc()));
      transcript.view = 'en';
      wrapper = mount(OutputView);
      expect(wrapper.get('.actions button').text()).toBe('Edit text');
      expect(wrapper.findAll('li.turn textarea')).toHaveLength(0);

      await editButton()!.trigger('click');
      expect(transcript.view).toBe('original');
      expect(editButton()!.text()).toBe('Done');
      expect(wrapper.getComponent(TurnList).props('editable')).toBe(true);
      expect(wrapper.findAll('li.turn textarea')).toHaveLength(5);
      expect(announcement()).toBe('Editing');

      await editButton()!.trigger('click');
      expect(editButton()!.text()).toBe('Edit text');
      expect(wrapper.findAll('li.turn textarea')).toHaveLength(0);
      expect(announcement()).toBe('Editing finished');
    });

    it('hides the version switch and Translate while editing, and keeps the download', async () => {
      await useTranscriptStore().setDoc(withTranslation(makeDoc()));
      wrapper = mount(OutputView);
      const actions = () => wrapper!.get('.actions');

      await editButton()!.trigger('click');
      expect(actions().findComponent(VersionToggle).exists()).toBe(false);
      expect(actions().findComponent(TranslateButton).exists()).toBe(false);
      expect(actions().findComponent(ExportButton).exists()).toBe(true);
      expect(wrapper.findComponent(SpeakerPanel).exists()).toBe(true);

      await editButton()!.trigger('click');
      expect(actions().findComponent(VersionToggle).exists()).toBe(true);
      expect(actions().findComponent(TranslateButton).exists()).toBe(true);
    });

    it('is not offered while a translation runs', async () => {
      await useTranscriptStore().setDoc(makeDoc());
      const translation = useTranslationStore();
      translation.status = 'running';
      wrapper = mount(OutputView);
      expect(editButton()).toBeUndefined();

      translation.status = 'idle';
      await flushPromises();
      expect(editButton()?.text()).toBe('Edit text');
    });

    it('saves what is typed to the transcript', async () => {
      const transcript = useTranscriptStore();
      await transcript.setDoc(makeDoc());
      wrapper = mount(OutputView);
      await editButton()!.trigger('click');
      await wrapper.findAll('li.turn textarea')[1]!.setValue('Danke schön.');
      expect(transcript.doc?.turns[1]?.text).toBe('Danke schön.');
    });

    it('is off when the view opens again', async () => {
      await useTranscriptStore().setDoc(makeDoc());
      wrapper = mount(OutputView);
      await editButton()!.trigger('click');
      wrapper.unmount();

      wrapper = mount(OutputView);
      expect(editButton()?.text()).toBe('Edit text');
      expect(wrapper.findAll('li.turn textarea')).toHaveLength(0);
    });
  });

  describe('playback', () => {
    beforeEach(() => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    });

    it('shows the player below the turns, with timestamps as text until audio is attached', async () => {
      await useTranscriptStore().setDoc(makeDoc());
      wrapper = mount(OutputView);
      expect(wrapper.findComponent(AudioBar).exists()).toBe(true);
      expect(wrapper.getComponent(TurnList).props('playable')).toBe(false);
      expect(wrapper.find('li.turn button').exists()).toBe(false);
    });

    it('plays from the turn that is clicked', async () => {
      await useTranscriptStore().setDoc(makeDoc());
      const playback = usePlaybackStore();
      playback.attachFromRunFile(new File(['x'], 'interview.mp3'));
      const seek = vi.spyOn(playback, 'seekTo');
      wrapper = mount(OutputView);
      await flushPromises();
      const list = wrapper.getComponent(TurnList);
      expect(list.props('playable')).toBe(true);
      expect(list.props('follow')).toBe(true);

      await wrapper.findAll('li.turn button')[2]?.trigger('click');
      expect(seek).toHaveBeenCalledExactlyOnceWith(makeDoc().turns[2]!.start);
    });

    it('stops following when the user turns it off or scrolls while playing', async () => {
      await useTranscriptStore().setDoc(makeDoc());
      const playback = usePlaybackStore();
      playback.attachFromRunFile(new File(['x'], 'interview.mp3'));
      wrapper = mount(OutputView);
      const list = () => wrapper!.getComponent(TurnList);

      playback.followPlayback = false;
      await flushPromises();
      expect(list().props('follow')).toBe(false);

      playback.followPlayback = true;
      playback.followPaused = true;
      await flushPromises();
      expect(list().props('follow')).toBe(false);
    });

    it('has no player when no speech was detected', async () => {
      await useTranscriptStore().setDoc(makeDoc({ speakers: [], turns: [] }));
      wrapper = mount(OutputView);
      expect(wrapper.findComponent(AudioBar).exists()).toBe(false);
    });
  });

  it('says so when no speech was detected', async () => {
    await useTranscriptStore().setDoc(makeDoc({ speakers: [], turns: [] }));
    wrapper = mount(OutputView);
    expect(wrapper.text()).toContain('No speech was detected in this recording.');
    expect(wrapper.findComponent(SpeakerPanel).exists()).toBe(false);
    expect(showsTranscript()).toBe(false);
    expect(wrapper.findComponent(ExportButton).exists()).toBe(false);
  });

  it.each(['uploading', 'processing'] as const)(
    'hides an earlier transcript while %s',
    async (status) => {
      await useTranscriptStore().setDoc(makeDoc());
      useJobStore().status = status;
      wrapper = mount(OutputView);
      expect(wrapper.findComponent(JobStatus).exists()).toBe(true);
      expect(showsTranscript()).toBe(false);
      expect(footer().exists()).toBe(false);
    },
  );

  it.each(['error', 'cancelled'] as const)(
    'after a run ends in %s, shows the status and Back to setup instead of the transcript',
    async (status) => {
      await useTranscriptStore().setDoc(makeDoc());
      const job = useJobStore();
      job.status = status;
      if (status === 'error') job.error = new ProviderError('server', 'ElevenLabs had a problem.');
      wrapper = mount(OutputView);
      expect(wrapper.findComponent(JobStatus).exists()).toBe(true);
      expect(showsTranscript()).toBe(false);

      const nav = useNavStore();
      const back = footer().get('button');
      expect(back.text()).toBe('Back to setup');
      await back.trigger('click');
      expect(nav.step).toBe('setup');
    },
  );

  it('shows the transcript again once the failed run is dismissed', async () => {
    await useTranscriptStore().setDoc(makeDoc());
    const job = useJobStore();
    job.status = 'cancelled';
    wrapper = mount(OutputView);
    job.dismiss();
    await flushPromises();
    expect(showsTranscript()).toBe(true);
  });

  it('warns when the transcript could not be saved', async () => {
    const transcript = useTranscriptStore();
    await transcript.setDoc(makeDoc());
    transcript.saveFailed = true;
    wrapper = mount(OutputView);
    expect(wrapper.get('.notice').text()).toContain("This browser isn't saving transcripts");
  });

  it('moves focus to the heading when the focused button disappears', async () => {
    const job = useJobStore();
    job.$patch({ status: 'processing' });
    vi.spyOn(job, 'cancel').mockImplementation(() => {
      job.status = 'cancelled';
    });
    wrapper = mount(OutputView, { attachTo: document.body });
    const cancel = wrapper.get('[data-testid="job-status"] button');
    (cancel.element as HTMLButtonElement).focus();
    await cancel.trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('h1').element);
  });
});

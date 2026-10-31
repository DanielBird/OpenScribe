import { defineStore } from 'pinia';
import { useGlossaryStore } from './glossary';
import { useJobStore } from './job';
import { useNavStore } from './nav';
import { usePipelineStore } from './pipeline';
import { useProjectStore } from './project';
import { useSettingsStore } from './settings';
import { useTranscriptStore } from './transcript';

// "Clear saved data" on Settings: the glossary, the preferences, the last transcript, the remembered
// project folder and its text cache. API keys are separate ("Forget all keys" in the settings store), and the
// project folder's own files are never touched.
export const useSavedDataStore = defineStore('savedData', () => {
  /** Deletes the saved data and resets what is shown. A transcription that is running carries on. */
  async function clearSavedData(): Promise<void> {
    usePipelineStore().cancel();
    useGlossaryStore().clear();
    useSettingsStore().resetPrefs();
    const cleared = Promise.all([useTranscriptStore().clear(), useProjectStore().forget()]);
    useJobStore().dismiss();
    const nav = useNavStore();
    // Without changing the mode, so clearing on Home stays on Home.
    if (!nav.canEnter(nav.step)) nav.resetStep();
    await cleared;
  }

  return { clearSavedData };
});

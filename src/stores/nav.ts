import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useJobStore } from './job';
import { useTranscriptStore } from './transcript';

export type Mode = 'home' | 'transcribe' | 'project' | 'settings';

export type Step = 'setup' | 'glossary' | 'output';

export const STEPS: readonly Step[] = ['setup', 'glossary', 'output'];

// Navigation is two values in a store, the mode and Transcribe's step; there is no router (DECISIONS.md D1).
export const useNavStore = defineStore('nav', () => {
  /** The app always opens on Home (PROJECTS.md A13). */
  const mode = ref<Mode>('home');
  /** Transcribe's step. It keeps its value while another mode is shown. */
  const step = ref<Step>('setup');
  /** Where Settings' Back returns to. */
  const returnTo = ref<Exclude<Mode, 'settings'>>('home');

  function canEnter(target: Step): boolean {
    switch (target) {
      case 'setup':
      case 'glossary':
        return true;
      case 'output':
        return useTranscriptStore().doc !== null || useJobStore().status !== 'idle';
    }
  }

  /** Shows `target`. Transcribe returns to the step left, or to Setup if that step can't be entered. */
  function enter(target: Mode): void {
    if (target === 'transcribe' && !canEnter(step.value)) step.value = 'setup';
    mode.value = target;
  }

  function goHome(): void {
    mode.value = 'home';
  }

  /**
   * Moves to `target` in Transcribe, from any mode, if it can be entered. Returns whether the step changed or
   * was already current.
   */
  function goTo(target: Step): boolean {
    if (!canEnter(target)) return false;
    step.value = target;
    mode.value = 'transcribe';
    return true;
  }

  /** Shows Settings, remembering the mode to return to. */
  function openSettings(): void {
    if (mode.value !== 'settings') returnTo.value = mode.value;
    mode.value = 'settings';
  }

  /** Returns from Settings to the mode it was opened from. Transcribe keeps its step. */
  function leaveSettings(): void {
    enter(returnTo.value);
  }

  /** Puts Transcribe back on Setup without leaving the current mode. */
  function resetStep(): void {
    step.value = 'setup';
  }

  return { mode, step, canEnter, enter, goHome, goTo, openSettings, leaveSettings, resetStep };
});

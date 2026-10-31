<script setup lang="ts">
import { computed } from 'vue';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import { useConfirm } from '../composables/useConfirm';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import GlossaryEditor from '../components/GlossaryEditor.vue';
import StepFooter from '../components/StepFooter.vue';

const settings = useSettingsStore();
const nav = useNavStore();
const job = useJobStore();
const transcript = useTranscriptStore();
const { confirm, dialog } = useConfirm();

const missing = computed(() =>
  job.isActive
    ? [...settings.missingRequirements, 'A transcription is already running.']
    : settings.missingRequirements,
);
const canRun = computed(() => missing.value.length === 0);

async function run(): Promise<void> {
  const last = transcript.autosaveInfo;
  if (
    last &&
    !(await confirm({
      title: 'Start a new transcription?',
      message: `This replaces your last transcript ("${last.fileName}").`,
      confirmLabel: 'Run',
    }))
  ) {
    return;
  }
  // start() first: it leaves `idle` synchronously, which is what lets the nav guard open Output.
  void job.start();
  nav.goTo('output');
}
</script>

<template>
  <section class="view" aria-labelledby="glossary-title">
    <!-- The step nav shows the title; this heading names the view and takes focus on step change. -->
    <h1 id="glossary-title" class="visually-hidden" tabindex="-1">Glossary</h1>

    <GlossaryEditor />

    <StepFooter :missing="missing">
      <template #back>
        <button type="button" class="button" @click="nav.goTo('setup')">
          <svg
            class="step-arrow step-arrow-back"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M13 8H3M7 4 3 8l4 4" />
          </svg>
          Back
        </button>
      </template>
      <template #primary="{ describedBy }">
        <button
          type="button"
          class="button button-primary"
          :disabled="!canRun"
          :aria-describedby="describedBy"
          @click="run"
        >
          Run
          <svg
            class="step-arrow step-arrow-next"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </button>
      </template>
    </StepFooter>

    <ConfirmDialog v-bind="dialog" />
  </section>
</template>

<style scoped>
/* Fills <main>, so the StepFooter can sit at the bottom of the window. */
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
}
</style>

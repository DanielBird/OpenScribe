<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { normalizeLanguage } from '../../domain/transcript';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { usePipelineStore } from '../../stores/pipeline';
import { usePlaybackStore } from '../../stores/playback';
import { useTranscriptStore } from '../../stores/transcript';
import { useTranslationStore } from '../../stores/translation';
import AddToProjectButton from '../components/AddToProjectButton.vue';
import AudioBar from '../components/AudioBar.vue';
import ExportButton from '../components/ExportButton.vue';
import FolderNotice from '../components/FolderNotice.vue';
import JobStatus from '../components/JobStatus.vue';
import SpeakerPanel from '../components/SpeakerPanel.vue';
import StepFooter from '../components/StepFooter.vue';
import TranscriptHeader from '../components/TranscriptHeader.vue';
import TranslateButton from '../components/TranslateButton.vue';
import TurnList from '../components/TurnList.vue';
import VersionToggle from '../components/VersionToggle.vue';

const job = useJobStore();
const transcript = useTranscriptStore();
const nav = useNavStore();
const playback = usePlaybackStore();
const translation = useTranslationStore();
const pipeline = usePipelineStore();

// A run that is active, failed or was cancelled takes the whole view. An earlier transcript stays
// saved and comes back when the run is dismissed (Setup's "Open").
const showJob = computed(
  () => job.isActive || job.status === 'error' || job.status === 'cancelled',
);
const failed = computed(() => job.status === 'error' || job.status === 'cancelled');
const hasTurns = computed(() => (transcript.doc?.turns.length ?? 0) > 0);

// The English texts when the view shows the translation; the original otherwise.
const english = computed(() =>
  transcript.view === 'en' ? transcript.doc?.translations.en?.texts : undefined,
);
const shownLanguage = computed(() =>
  english.value ? 'en' : normalizeLanguage(transcript.doc?.result.languageCode ?? ''),
);
// In the English view, the turns changed since they were translated (DECISIONS.md D39).
const outdated = computed(() =>
  english.value && transcript.staleTurnIds.length > 0
    ? new Set(transcript.staleTurnIds)
    : undefined,
);

// The pipeline (Add to project, a summary) is working on this transcript: as during a translation, the text
// isn't edited and Translate isn't offered.
const pipelineWorking = computed(() =>
  transcript.doc ? pipeline.jobFor(transcript.doc.id) !== null : false,
);

// Edit text (DECISIONS.md D19) changes the original only, so it shows the Original and hides the
// version switch and Translate. Not offered while a translation runs, which would switch the view.
// Local state: editing is off whenever the Output tab opens again.
const editing = ref(false);
watch(pipelineWorking, (working) => {
  if (working) editing.value = false;
});
const editAnnouncement = ref('');

function toggleEditing(): void {
  editing.value = !editing.value;
  if (editing.value) transcript.view = 'original';
  editAnnouncement.value = editing.value ? 'Editing' : 'Editing finished';
}

// The focused button (Cancel, Try again) can disappear with a status change. Keep keyboard and
// screen-reader users in the view instead of at the top of the page.
const heading = useTemplateRef<HTMLElement>('heading');
watch(
  () => job.status,
  async () => {
    await nextTick();
    const active = document.activeElement;
    if (!active || active === document.body) heading.value?.focus();
  },
);
</script>

<template>
  <section class="view" aria-labelledby="output-title">
    <!-- The step nav shows the title; this heading names the view and takes focus on step change. -->
    <h1 id="output-title" ref="heading" class="visually-hidden" tabindex="-1">Output</h1>

    <JobStatus v-if="showJob" />

    <template v-else-if="transcript.doc">
      <!-- The recording's name leads; Add to project comes last in the actions, as the main one. -->
      <div class="title-block">
        <TranscriptHeader :doc="transcript.doc" :project="transcript.projectLink?.projectName" />
        <div v-if="hasTurns" class="actions">
          <button
            v-if="!translation.isRunning && !pipelineWorking"
            type="button"
            class="button"
            @click="toggleEditing"
          >
            {{ editing ? 'Done' : 'Edit text' }}
          </button>
          <template v-if="!editing">
            <TranslateButton v-if="!pipelineWorking" />
            <VersionToggle />
          </template>
          <ExportButton />
          <AddToProjectButton />
          <span class="visually-hidden" role="status" aria-live="polite">{{
            editAnnouncement
          }}</span>
        </div>
      </div>
      <FolderNotice />
      <p v-if="transcript.saveFailed" class="notice" role="status">
        This browser isn't saving transcripts, so this one will be lost when you close the tab.
      </p>
      <template v-if="hasTurns">
        <SpeakerPanel />
        <TurnList
          :turns="transcript.doc.turns"
          :speakers="transcript.doc.speakers"
          :texts="english"
          :lang="shownLanguage || undefined"
          :playable="playback.playable"
          :active-id="playback.activeTurnId"
          :follow="playback.followPlayback && !playback.followPaused"
          :editable="editing"
          :outdated="outdated"
          @select="playback.seekTo($event.start)"
          @edit="(turnId, text) => transcript.editTurnText(turnId, text)"
        />
        <AudioBar />
      </template>
      <p v-else class="empty">No speech was detected in this recording.</p>
    </template>

    <p v-else class="empty">No transcript yet. Start on the Setup tab.</p>

    <StepFooter v-if="failed">
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
          Back to setup
        </button>
      </template>
    </StepFooter>
  </section>
</template>

<style scoped>
/* Fills <main>, so the StepFooter can sit at the bottom of the window. */
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
}

/* The name and its details on the left; the actions beside them, or below on a narrow window. */
.title-block {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4) var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--color-border);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.notice {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.empty {
  color: var(--color-text-muted);
}
</style>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useNavStore } from '../../stores/nav';
import { useSettingsStore } from '../../stores/settings';
import FileDrop from '../components/FileDrop.vue';
import LastTranscriptBanner from '../components/LastTranscriptBanner.vue';
import StepFooter from '../components/StepFooter.vue';

const settings = useSettingsStore();
const nav = useNavStore();
const id = useId();
const ids = {
  language: `${id}-language`,
  speakers: `${id}-speakers`,
  speakersHelp: `${id}-speakers-help`,
  zeroRetention: `${id}-zero-retention`,
  zeroRetentionHelp: `${id}-zero-retention-help`,
  optionsPanel: `${id}-options-panel`,
};

const optionsOpen = ref(false);
// The keys are on Settings (D27); Setup only points there while the required one is missing.
const keyMissing = computed(() => settings.elevenLabsKey.trim() === '');

const languages = [{ code: 'auto', label: 'Auto-detect' }, ...settings.languages];

// NaN (an entry that isn't a number) is left out so that re-rendering doesn't wipe what the user typed.
const speakersValue = computed(() => {
  const n = settings.numSpeakers;
  return n === null || Number.isNaN(n) ? undefined : n;
});

function onSpeakersInput(event: Event): void {
  const el = event.target as HTMLInputElement;
  if (el.validity.badInput) settings.numSpeakers = Number.NaN;
  else settings.numSpeakers = el.value === '' ? null : Number(el.value);
}

// Collapsed, Options says what it holds, so it needn't be opened to check.
const optionsSummary = computed(() => {
  const language =
    languages.find((lang) => lang.code === settings.languageHint)?.label ?? 'Auto-detect';
  const parts = [`Language: ${language}`, `Speakers: ${speakersValue.value ?? 'Auto'}`];
  if (settings.zeroRetention) parts.push('Zero retention');
  return parts.join(' · ');
});
</script>

<template>
  <section class="view" aria-labelledby="setup-title">
    <!-- The step nav shows the title; this heading names the view and takes focus on step change. -->
    <h1 id="setup-title" class="visually-hidden" tabindex="-1">Setup</h1>

    <div class="sheet">
      <section class="band" aria-labelledby="setup-recording">
        <h2 id="setup-recording">Recording</h2>
        <div class="band-content recording">
          <FileDrop
            :file="settings.file"
            :duration-sec="settings.fileDurationSec"
            :probing="settings.fileProbing"
            :check="settings.fileCheck"
            @select="settings.setFile"
            @remove="settings.clearFile"
          />
          <LastTranscriptBanner />
        </div>
      </section>

      <section v-if="keyMissing" class="band" aria-labelledby="setup-key">
        <h2 id="setup-key">API key</h2>
        <div class="band-content">
          <div>
            <button type="button" class="button" @click="nav.openSettings()">Open Settings</button>
          </div>
        </div>
      </section>

      <section class="band" aria-labelledby="setup-options">
        <h2 id="setup-options">
          <button
            type="button"
            class="band-toggle"
            :aria-expanded="optionsOpen"
            :aria-controls="ids.optionsPanel"
            @click="optionsOpen = !optionsOpen"
          >
            Options
          </button>
        </h2>
        <p v-if="!optionsOpen" class="band-summary">{{ optionsSummary }}</p>
        <div v-show="optionsOpen" :id="ids.optionsPanel" class="band-content">
          <div class="field">
            <label :for="ids.language" class="label">Language</label>
            <select :id="ids.language" v-model="settings.languageHint" class="control">
              <option v-for="lang in languages" :key="lang.code" :value="lang.code">
                {{ lang.label }}
              </option>
            </select>
          </div>

          <div class="field">
            <label :for="ids.speakers" class="label">Number of speakers</label>
            <input
              :id="ids.speakers"
              class="control speakers"
              type="number"
              inputmode="numeric"
              min="1"
              max="32"
              step="1"
              placeholder="Auto"
              :value="speakersValue"
              :aria-describedby="ids.speakersHelp"
              @input="onSpeakersInput"
            />
            <p :id="ids.speakersHelp" class="hint">
              Set this if you know it (e.g. 2 for an interview). It improves speaker separation.
            </p>
          </div>

          <div class="field">
            <label :for="ids.zeroRetention" class="label">Zero retention</label>
            <button
              :id="ids.zeroRetention"
              type="button"
              role="switch"
              class="control toggle"
              :aria-checked="settings.zeroRetention"
              :aria-describedby="ids.zeroRetentionHelp"
              @click="settings.zeroRetention = !settings.zeroRetention"
            >
              {{ settings.zeroRetention ? 'On' : 'Off' }}
            </button>
            <p :id="ids.zeroRetentionHelp" class="hint">
              Asks ElevenLabs not to store your audio or transcript. Only Enterprise plans can use
              this.
            </p>
          </div>
        </div>
      </section>
    </div>

    <StepFooter :missing="settings.missingRequirements">
      <template #primary="{ describedBy }">
        <button
          type="button"
          class="button button-primary"
          :disabled="!settings.isReady"
          :aria-describedby="describedBy"
          @click="nav.goTo('glossary')"
        >
          Next
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

/* The band layout itself is in base.css, shared with Settings. */

/* A section that opens and closes keeps its name at the top of the band. On the baseline it would move
   when the section opens: the first line of Options is a label centred against its taller select. */
.band > h2:has(.band-toggle) {
  align-self: start;
}

.band-summary {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  transition: color 0.15s;
}

.band:has(.band-toggle:hover) .band-summary {
  color: var(--color-text);
}

/* The last-transcript line sits close to the recording. */
.band-content.recording {
  gap: var(--space-3);
}

.band-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-weight: inherit;
  text-align: left;
  cursor: pointer;
}

.band-toggle:hover {
  color: var(--color-accent);
}

/* A collapsed band opens from anywhere on its row, summary included. */
.band-toggle[aria-expanded='false']::after {
  position: absolute;
  inset: 0;
  content: '';
}

/* Chevrons drawn with two borders: down when closed, up when open. */
.band-toggle::before {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  color: var(--color-text-muted);
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

/* After the label, not before it. */
.band-toggle::before {
  order: 1;
}

.band-toggle[aria-expanded='true']::before {
  transform: translateY(25%) rotate(-135deg);
}

.band-toggle:hover::before {
  color: var(--color-accent);
}

/* Label (and hint, if any) on the left; the control on the right, centred against both. */
.field {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: var(--space-4);
}

.field .label {
  grid-column: 1;
  grid-row: 1;
}

.field .hint {
  grid-column: 1;
  grid-row: 2;
  margin-top: var(--space-1);
}

.field > :is(.control, .toggle) {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.field:not(:has(.hint)) > :is(.control, .toggle) {
  grid-row: 1;
}

.label {
  font-weight: 600;
}

/* The select and the number input share one width. */
.field .control {
  box-sizing: border-box;
  width: 8rem;
  height: 2.625rem;
}

.speakers {
  text-align: center;
}

.toggle {
  cursor: pointer;
}

.toggle:hover {
  border-color: var(--color-accent);
}

.toggle[aria-checked='true'] {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
}

/* Narrow windows stack each band's name above its summary, as base.css does for its content. */
@media (max-width: 40rem) {
  .band-summary {
    grid-column: 1;
    grid-row: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .band-summary,
  .band-toggle::before {
    transition: none;
  }
}
</style>

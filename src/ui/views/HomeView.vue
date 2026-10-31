<script setup lang="ts">
import { computed } from 'vue';
import { useJobStore } from '../../stores/job';
import { useNavStore } from '../../stores/nav';
import { useProjectStore } from '../../stores/project';
import { useTranslationStore } from '../../stores/translation';

const nav = useNavStore();
const job = useJobStore();
const translation = useTranslationStore();
const project = useProjectStore();

// What Transcribe is doing in the background, if anything. It carries on while Home is shown.
const running = computed(() => {
  if (job.isActive) return 'Transcribing…';
  if (translation.isRunning) return 'Translating…';
  return null;
});
</script>

<template>
  <section class="view" aria-labelledby="home-title">
    <!-- The top row shows the title; this heading names the view and takes focus on a mode change. -->
    <h1 id="home-title" class="visually-hidden" tabindex="-1">Home</h1>

    <div class="modes">
      <button type="button" class="mode" @click="nav.enter('transcribe')">
        <span class="mode-name">Transcribe</span>
        <svg
          class="mode-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
        <span v-if="running" class="mode-status busy">{{ running }}</span>
      </button>
      <button type="button" class="mode" @click="nav.enter('project')">
        <span class="mode-name">Analyse</span>
        <svg
          class="mode-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
        <span v-if="project.projectName" class="mode-status">{{ project.projectName }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

/* A tile with no outline: the mode's name and an arrow at the top, what the mode is doing at the bottom.
   A faint accent tint at rest; the accent fills the whole tile on hover. The lines are grid items, so the
   accessible name keeps a space between them. */
.mode {
  display: grid;
  grid-template-areas:
    'name arrow'
    '. .'
    'status status';
  grid-template-rows: auto 1fr auto;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2);
  min-height: 12rem;
  padding: var(--space-5);
  border: 0;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-accent) 4%, var(--color-surface));
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition:
    background-color 200ms cubic-bezier(0.22, 1, 0.36, 1),
    color 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mode:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.mode:active {
  background: var(--color-accent-hover);
  color: var(--color-on-accent);
}

.mode-name {
  grid-area: name;
  font-size: clamp(2.25rem, 1rem + 4vw, 3.5rem);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

/* Centred on the name's line, however large the name is. */
.mode-arrow {
  grid-area: arrow;
  align-self: center;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--color-text-muted);
  transition:
    color 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.mode-status {
  display: flex;
  grid-area: status;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* A pulsing dot: the mode is working in the background. */
.mode-status.busy::before {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  content: '';
  animation: pulse 1.6s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.mode:is(:hover, :active) .mode-arrow {
  color: var(--color-on-accent);
  transform: translate(0.125rem, -0.125rem);
}

.mode:is(:hover, :active) .mode-status {
  color: var(--color-on-accent);
}

.mode:is(:hover, :active) .mode-status.busy::before {
  background: var(--color-on-accent);
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 30rem) {
  .modes {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode {
    min-height: 8rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mode,
  .mode-arrow {
    transition: none;
  }

  .mode-status.busy::before {
    animation: none;
  }
}
</style>

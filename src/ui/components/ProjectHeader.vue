<script setup lang="ts">
import { useId } from 'vue';
import { useProjectUi } from '../composables/useProjectUi';
import ProjectModelSelect from './ProjectModelSelect.vue';

// The Project row's controls, beside "Home / <project name>": the brief, Change, which shows the chooser to open or
// create another project, and the project model (saved on this computer, DECISIONS.md D23; Claude or Gemini, D26).
const ui = useProjectUi();
const id = useId();
</script>

<template>
  <div class="project-header">
    <button type="button" class="quiet" @click="ui.briefOpen = true">Brief</button>
    <button id="project-change" type="button" class="quiet" @click="ui.choosing = true">
      Change
    </button>
    <label :for="`${id}-model`" class="visually-hidden">Model</label>
    <ProjectModelSelect :id="`${id}-model`" class="model" />
  </div>
</template>

<style scoped>
.project-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

/* Quiet controls: no box until focused, and a grey fill on hover, so the row stays a line of words. */
.quiet,
.model {
  padding: var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* The fill reaches as far as the focus ring (2px offset + 2px outline) without moving the row. */
.quiet:hover,
.model:hover {
  background: var(--color-surface);
  box-shadow: 0 0 0 4px var(--color-surface);
  color: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
  .quiet,
  .model {
    transition: none;
  }
}
</style>

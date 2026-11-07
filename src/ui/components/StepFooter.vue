<script setup lang="ts">
import { computed, useId } from 'vue';

// The step buttons (Back / Next / Run) at the bottom of every view. The parent view fills the height
// of <main>, so the bar sits at the bottom of the window on short pages and stays pinned there while
// a long page scrolls. `missing` lists why the primary button is disabled; the `primary` slot gets
// the list's id for aria-describedby.
const props = withDefaults(defineProps<{ missing?: readonly string[] }>(), {
  missing: () => [],
});
defineSlots<{
  back?: () => unknown;
  primary?: (props: { describedBy: string | undefined }) => unknown;
}>();

const missingId = `${useId()}-missing`;
const describedBy = computed(() => (props.missing.length > 0 ? missingId : undefined));
</script>

<template>
  <div class="step-footer" data-testid="step-footer">
    <div class="back">
      <slot name="back" />
    </div>
    <div class="primary">
      <ul v-if="missing.length > 0" :id="missingId" class="missing">
        <li v-for="reason in missing" :key="reason">{{ reason }}</li>
      </ul>
      <slot name="primary" v-bind="{ describedBy }" />
    </div>
  </div>
</template>

<style scoped>
.step-footer {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
  margin-top: auto;
  padding-block: var(--space-3);
  background: var(--color-bg);
}

/* No rule above the bar, like the step nav. A long page fades out as it scrolls under the bar
   instead; on a short page there is nothing under it, so the fade doesn't show. */
.step-footer::before {
  position: absolute;
  inset-inline: 0;
  bottom: 100%;
  height: var(--space-5);
  background: linear-gradient(to bottom, transparent, var(--color-bg));
  content: '';
  pointer-events: none;
}

/* Back is the quiet way out: text and an arrow, no box. It keeps the button's padding so it lines
   up with the primary button's height and still has a full-size target. */
:slotted(.button:not(.button-primary)) {
  margin-inline-start: calc(var(--space-3) * -1);
  border-color: transparent;
  background: none;
  color: var(--color-text-muted);
  transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

:slotted(.button:not(.button-primary):hover:not(:disabled)) {
  border-color: transparent;
  background: none;
  color: var(--color-accent);
}

/* The primary button is a flat block in every state (blue, or grey while disabled), with no outline,
   and its label sits in the middle. The transparent border keeps its height equal to Back's. */
:slotted(.button-primary),
:slotted(.button-primary:hover:not(:disabled)),
:slotted(.button-primary:disabled) {
  justify-content: center;
  border-color: transparent;
}

:slotted(.step-arrow) {
  flex: none;
  width: 1rem;
  height: 1rem;
  transition: translate 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* The arrow leans the way the button goes. */
:slotted(.button:hover:not(:disabled) .step-arrow-back) {
  translate: -2px 0;
}

:slotted(.button:hover:not(:disabled) .step-arrow-next) {
  translate: 2px 0;
}

@media (prefers-reduced-motion: reduce) {
  :slotted(.step-arrow) {
    transition: none;
  }
}

.primary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2) var(--space-4);
  margin-left: auto;
}

.missing {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-align: right;
}
</style>

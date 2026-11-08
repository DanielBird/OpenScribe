<script setup lang="ts">
import { useId } from 'vue';
import { BUDGET_LEVELS, readingHours, TOOL_CALL_LEVELS } from '../../features/agent/limits';
import { AGENT_EFFORTS, PROJECT_MODELS } from '../../providers/llm/models';
import type { AgentEffort } from '../../providers/llm/types';
import { useSettingsStore } from '../../stores/settings';
import { PROVIDER_LIST } from '../providerNames';

// The project model (saved on this computer, DECISIONS.md D23, D26): one flat list, each provider's models together.
// Used by the Analyse header and the Add to project dialog; the parent supplies the label (via `id`) and the styling
// (via `class`), which go on the select. `chatSettings` adds the chat's effort and budgets per question (D48), for the
// header, where the chat is.
defineOptions({ inheritAttrs: false });
defineProps<{ chatSettings?: boolean }>();

const settings = useSettingsStore();
const id = useId();

const models = PROVIDER_LIST.flatMap((p) =>
  PROJECT_MODELS.options.filter((m) => m.provider === p.id),
);

const EFFORT_LABELS: Record<AgentEffort, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const groups = [
  {
    key: 'agentEffort',
    legend: 'Effort',
    tip: 'How hard the model thinks at each step.',
    options: AGENT_EFFORTS.map((value) => ({ value, label: EFFORT_LABELS[value], hidden: '' })),
  },
  {
    key: 'agentToolBudget',
    legend: 'Tool calls',
    tip: 'How many searches and reads the model can make.',
    options: BUDGET_LEVELS.map((value) => ({
      value,
      label: String(TOOL_CALL_LEVELS[value]),
      hidden: '',
    })),
  },
  {
    key: 'agentReadingBudget',
    legend: 'Reading',
    tip: 'How many hours of transcript the model can read.',
    options: BUDGET_LEVELS.map((value) => ({
      value,
      label: `${readingHours(value)} h`,
      hidden: ' of transcript',
    })),
  },
] as const;
</script>

<template>
  <span class="project-model">
    <select v-bind="$attrs" v-model="settings.projectModel">
      <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
    </select>
    <template v-if="chatSettings">
      <button
        type="button"
        class="settings-button"
        :popovertarget="`${id}-settings`"
        aria-label="Chat settings"
        title="Chat settings"
      >
        <svg
          class="icon"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M2 4.5h6M12 4.5h2M2 11.5h2M8 11.5h6" />
          <circle cx="10" cy="4.5" r="2" />
          <circle cx="6" cy="11.5" r="2" />
        </svg>
      </button>
      <div
        :id="`${id}-settings`"
        popover="auto"
        class="settings"
        role="group"
        aria-label="Chat settings"
      >
        <fieldset
          v-for="group in groups"
          :key="group.key"
          class="group"
          :aria-describedby="`${id}-${group.key}-tip`"
        >
          <legend class="legend">{{ group.legend }}</legend>
          <span :id="`${id}-${group.key}-tip`" role="tooltip" class="tip">{{ group.tip }}</span>
          <div class="levels">
            <label v-for="option in group.options" :key="option.value" class="level">
              <input
                v-model="settings[group.key]"
                type="radio"
                class="visually-hidden"
                :name="`${id}-${group.key}`"
                :value="option.value"
              />
              <span class="level-face">
                {{ option.label
                }}<span v-if="option.hidden" class="visually-hidden">{{ option.hidden }}</span>
              </span>
            </label>
          </div>
        </fieldset>
        <p class="hint">Per question. Higher costs more.</p>
      </div>
    </template>
  </span>
</template>

<style scoped>
.project-model {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.project-model > select {
  flex: 1 1 auto;
  min-width: 0;
}

/*
 * The open list is a customizable select (Chromium's `base-select`), so it can be wider than the closed control and have
 * rounded corners. Browsers without it show their native list.
 */
select,
select::picker(select) {
  appearance: base-select;
}

select::picker-icon {
  display: none;
}

select::picker(select) {
  min-width: max(anchor-size(width), 14rem);
  margin-block: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--color-text) 14%, transparent);
}

option {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

option:hover,
option:focus-visible {
  background: var(--color-surface);
  outline: none;
}

option:checked {
  color: var(--color-accent);
  font-weight: 600;
}

.settings-button {
  display: inline-flex;
  anchor-name: --chat-settings;
}

.icon {
  display: block;
  width: 1rem;
  height: 1rem;
}

/* Below the button, its right edge on the button's, or the other way round where that doesn't fit. */
.settings {
  position-anchor: --chat-settings;
  inset: auto;
  top: anchor(bottom);
  right: anchor(right);
  position-try-fallbacks: flip-inline, flip-block;
  box-sizing: border-box;
  width: 20rem;
  max-width: calc(100vw - 2 * var(--space-3));
  margin: var(--space-2) 0;
  padding: var(--space-3);
  overflow: visible;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--color-text) 14%, transparent);
  opacity: 0;
  translate: 0 -4px;
  transition:
    opacity 160ms cubic-bezier(0.22, 1, 0.36, 1),
    translate 160ms cubic-bezier(0.22, 1, 0.36, 1),
    display 160ms allow-discrete,
    overlay 160ms allow-discrete;
}

.settings:popover-open {
  opacity: 1;
  translate: 0;
}

@starting-style {
  .settings:popover-open {
    opacity: 0;
    translate: 0 -4px;
  }
}

.group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.group + .group {
  margin-top: var(--space-1);
}

/* Floated, so the levels sit beside it and the three settings share their columns. */
.legend {
  float: left;
  width: 5.5rem;
  padding: var(--space-1) 0;
  color: var(--color-text-muted);
  cursor: default;
}

.levels {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-1);
}

.level {
  cursor: pointer;
}

.level-face {
  display: block;
  padding: var(--space-1) 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  text-align: center;
  transition:
    background-color 160ms cubic-bezier(0.22, 1, 0.36, 1),
    color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.level:hover .level-face {
  background: var(--color-surface);
  color: var(--color-text);
}

.level input:checked + .level-face {
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
  color: var(--color-accent-hover);
  font-weight: 600;
}

.level input:focus-visible + .level-face {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
}

/* Two lines tall, the most an explanation needs, so the panel doesn't change size when one replaces it. */
.hint {
  min-height: 2lh;
  margin: var(--space-3) 0 0;
  color: var(--color-text-muted);
}

/* What a setting does: in the hint's place, measured from the panel. The pointer wins over the keyboard focus. */
.tip {
  position: absolute;
  inset-inline: var(--space-3);
  bottom: var(--space-3);
  color: var(--color-text-muted);
  visibility: hidden;
}

.group:hover .tip,
.settings:not(:has(.group:hover)) .group:has(input:focus-visible) .tip {
  visibility: visible;
}

.settings:has(.group:hover) .hint,
.settings:has(input:focus-visible) .hint {
  visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .settings,
  .level-face {
    transition: none;
  }
}
</style>

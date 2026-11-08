<script setup lang="ts">
import { PROJECT_MODELS } from '../../providers/llm/models';
import { useSettingsStore } from '../../stores/settings';
import { PROVIDER_LIST } from '../providerNames';

// The project model (saved on this computer, DECISIONS.md D23, D26): one flat list, each provider's models together.
// Used by the Analyse header and the Add to project dialog; the parent supplies the label (via `id`) and the styling
// (via `class`).
const settings = useSettingsStore();

const models = PROVIDER_LIST.flatMap((p) =>
  PROJECT_MODELS.options.filter((m) => m.provider === p.id),
);
</script>

<template>
  <select v-model="settings.projectModel">
    <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
  </select>
</template>

<style scoped>
/*
 * The open list is a customizable select (Chromium's `base-select`), so it can be wider than the closed control and have
 * rounded corners. Browsers without it show their native list.
 */
select,
select::picker(select) {
  appearance: base-select;
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
</style>

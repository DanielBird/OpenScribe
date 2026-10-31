<script setup lang="ts">
import { PROJECT_MODELS } from '../../providers/llm/models';
import { useSettingsStore } from '../../stores/settings';

// The project model (saved on this computer, DECISIONS.md D23, D26), grouped by provider. Used by the Analyse header
// and the Add to project dialog; the parent supplies the label (via `id`) and the styling (via `class`).
const settings = useSettingsStore();

const groups = [
  { label: 'Claude', provider: 'claude' },
  { label: 'Gemini', provider: 'gemini' },
].map((g) => ({
  ...g,
  models: PROJECT_MODELS.options.filter((m) => m.provider === g.provider),
}));
</script>

<template>
  <select v-model="settings.projectModel">
    <optgroup v-for="g in groups" :key="g.provider" :label="g.label">
      <option v-for="m in g.models" :key="m.id" :value="m.id">{{ m.label }}</option>
    </optgroup>
  </select>
</template>

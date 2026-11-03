<script setup lang="ts">
import { PROJECT_MODELS } from '../../providers/llm/models';
import { useSettingsStore } from '../../stores/settings';
import { PROVIDER_LIST } from '../providerNames';

// The project model (saved on this computer, DECISIONS.md D23, D26), grouped by provider. Used by the Analyse header
// and the Add to project dialog; the parent supplies the label (via `id`) and the styling (via `class`).
const settings = useSettingsStore();

const groups = PROVIDER_LIST.map((p) => ({
  label: p.label,
  provider: p.id,
  models: PROJECT_MODELS.options.filter((m) => m.provider === p.id),
}));
</script>

<template>
  <select v-model="settings.projectModel">
    <optgroup v-for="g in groups" :key="g.provider" :label="g.label">
      <option v-for="m in g.models" :key="m.id" :value="m.id">{{ m.label }}</option>
    </optgroup>
  </select>
</template>

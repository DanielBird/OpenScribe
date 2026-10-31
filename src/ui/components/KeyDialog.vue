<script setup lang="ts">
import { computed } from 'vue';
import type { LlmProviderId } from '../../domain/transcript';
import { useSettingsStore } from '../../stores/settings';
import { PROVIDER_NAMES } from '../providerNames';
import ApiKeyField from './ApiKeyField.vue';
import ConfirmDialog from './ConfirmDialog.vue';

// Asks for the provider's key before an action that needs it (PROJECTS.md §5.6, "Keys"), as the Translate dialog
// does. The slot says what is sent. The action itself runs after the dialog closes.
const props = defineProps<{
  open: boolean;
  title: string;
  confirmLabel: string;
  provider: LlmProviderId;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
defineSlots<{ default?: () => unknown }>();

const settings = useSettingsStore();
const keyMissing = computed(() => settings.keyFor(props.provider).trim() === '');

function onConfirm(): void {
  if (!keyMissing.value) emit('confirm');
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    :confirm-label="confirmLabel"
    :confirm-disabled="keyMissing"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div class="body">
      <ApiKeyField
        :key="provider"
        :provider="provider"
        :label="PROVIDER_NAMES[provider].keyLabel"
      />
      <p class="data-notice"><slot /></p>
    </div>
  </ConfirmDialog>
</template>

<style scoped>
.body {
  display: grid;
  gap: var(--space-4);
}

.data-notice {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
}
</style>

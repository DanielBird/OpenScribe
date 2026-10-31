<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePipelineStore } from '../../stores/pipeline';
import { useSettingsStore } from '../../stores/settings';
import { PROVIDER_NAMES } from '../providerNames';
import ApiKeyField from './ApiKeyField.vue';
import ConfirmDialog from './ConfirmDialog.vue';

// Before summaries are made in Project mode: **Summarise all** asks first, and any summary asks for the project
// provider's key (Claude or Gemini, D26) when it's missing or didn't work (PROJECTS.md §5.6, "Keys"). The work itself runs after the dialog closes.
const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Some of the sessions are translated first. */
  translates?: boolean;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const pipeline = usePipelineStore();
const settings = useSettingsStore();

/** Decided when the dialog opens, so the field stays while the key is typed. */
const keyNeeded = ref(false);
const keyMissing = computed(() => settings.keyFor(settings.projectProvider).trim() === '');
const names = computed(() => PROVIDER_NAMES[settings.projectProvider]);

watch(
  () => props.open,
  (open) => {
    if (open) keyNeeded.value = pipeline.needsKey;
  },
  { immediate: true },
);

function onConfirm(): void {
  if (!keyMissing.value) emit('confirm');
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    :title="title"
    :message="message"
    :confirm-label="confirmLabel"
    :confirm-disabled="keyMissing"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div v-if="keyNeeded" class="body">
      <ApiKeyField
        :key="settings.projectProvider"
        :provider="settings.projectProvider"
        :label="names.keyLabel"
      />
      <p class="data-notice">
        The transcript text is sent to {{ names.company }} to
        {{ translates ? 'translate and ' : '' }}summarise.
      </p>
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

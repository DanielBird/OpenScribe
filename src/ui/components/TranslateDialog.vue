<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { LlmProviderId } from '../../domain/transcript';
import { isKnownModel, LLM_MODELS } from '../../providers/llm/models';
import { useSettingsStore } from '../../stores/settings';
import { useTranslationStore } from '../../stores/translation';
import { PROVIDER_LIST, PROVIDER_NAMES } from '../providerNames';
import ApiKeyField from './ApiKeyField.vue';
import ConfirmDialog from './ConfirmDialog.vue';

// Choices for "Translate to English": provider, model and, when needed, the key. The translation itself
// runs after the dialog closes; TranslateButton shows its progress (DECISIONS.md D14).
const props = defineProps<{
  open: boolean;
  /**
   * `replace`: a translation exists already, and this one replaces it. `update`: some turns changed since it was
   * made, and only those are translated (DECISIONS.md D39).
   */
  mode: 'new' | 'update' | 'replace';
  /** How many turns changed, for `update`. */
  changed?: number;
}>();
const emit = defineEmits<{ translate: [provider: LlmProviderId, model: string]; cancel: [] }>();

const settings = useSettingsStore();
const translation = useTranslationStore();
const id = useId();
const ids = { model: `${id}-model` };

const provider = ref<LlmProviderId>(settings.translationProvider);
const model = ref<string>(settings.translationModel);
/** Decided when the dialog opens or the provider changes, so the field stays while the key is typed. */
const keyNeeded = ref(false);
const dontShowAgain = ref(false);

const info = computed(() => PROVIDER_NAMES[provider.value]);
const message = computed(() => {
  if (props.mode === 'replace') return 'This replaces the English translation.';
  if (props.mode === 'new') return '';
  const n = props.changed ?? 0;
  return `Translates only the ${n === 1 ? 'turn' : `${n} turns`} that changed.`;
});
const CONFIRM_LABELS = { new: 'Translate', update: 'Update', replace: 'Re-translate' } as const;
const keyMissing = computed(() => settings.keyFor(provider.value).trim() === '');
const showNotice = computed(() => !settings.hideTranslationNotice);

function needsKey(p: LlmProviderId): boolean {
  const authFailed = translation.error?.kind === 'auth' && translation.target?.providerId === p;
  return settings.keyFor(p).trim() === '' || authFailed;
}

/** The last model used with `p`, or its default. */
function modelFor(p: LlmProviderId): string {
  const last = settings.translationModel;
  return settings.translationProvider === p && isKnownModel(p, last) ? last : LLM_MODELS[p].default;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    provider.value = settings.translationProvider;
    model.value = modelFor(provider.value);
    keyNeeded.value = needsKey(provider.value);
    dontShowAgain.value = false;
  },
  { immediate: true },
);

function onProviderChange(): void {
  model.value = modelFor(provider.value);
  keyNeeded.value = needsKey(provider.value);
}

function onConfirm(): void {
  if (keyMissing.value) return;
  if (dontShowAgain.value) settings.hideTranslationNotice = true;
  emit('translate', provider.value, model.value);
}
</script>

<template>
  <ConfirmDialog
    :open="open"
    title="Translate to English"
    :message="message"
    :confirm-label="CONFIRM_LABELS[mode]"
    :confirm-disabled="keyMissing"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div class="body">
      <fieldset class="providers">
        <legend class="visually-hidden">Provider</legend>
        <label v-for="p in PROVIDER_LIST" :key="p.id" class="provider">
          <input
            v-model="provider"
            type="radio"
            :name="`${id}-provider`"
            :value="p.id"
            @change="onProviderChange"
          />
          {{ p.label }}
        </label>
      </fieldset>

      <div class="field">
        <label :for="ids.model" class="label">Model</label>
        <select :id="ids.model" :key="provider" v-model="model" class="control">
          <option v-for="m in LLM_MODELS[provider].options" :key="m.id" :value="m.id">
            {{ m.label }}
          </option>
        </select>
      </div>

      <ApiKeyField v-if="keyNeeded" :key="provider" :provider="provider" :label="info.keyLabel" />

      <div v-if="showNotice" class="data-notice">
        <p>
          Only the transcript text goes to {{ info.company }} ({{ info.label }}), not the audio.
        </p>
        <label class="dont-show">
          <input v-model="dontShowAgain" type="checkbox" />
          Don't show again
        </label>
      </div>
    </div>
  </ConfirmDialog>
</template>

<style scoped>
.body {
  display: grid;
  gap: var(--space-4);
}

.providers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: 0;
  padding: 0;
  border: 0;
}

.provider,
.dont-show {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.provider input {
  margin: 0;
  accent-color: var(--color-accent);
}

.field {
  display: grid;
  gap: var(--space-1);
}

.label {
  font-weight: 600;
}

.data-notice {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
}
</style>

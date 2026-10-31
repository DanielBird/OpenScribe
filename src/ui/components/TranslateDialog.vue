<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { LlmProviderId } from '../../domain/transcript';
import { isKnownModel, LLM_MODELS } from '../../providers/llm/models';
import { useSettingsStore } from '../../stores/settings';
import { useTranslationStore } from '../../stores/translation';
import ApiKeyField from './ApiKeyField.vue';
import ConfirmDialog from './ConfirmDialog.vue';

// Choices for "Translate to English": provider, model and, when needed, the key. The translation itself
// runs after the dialog closes; TranslateButton shows its progress (DECISIONS.md D14).
const props = defineProps<{
  open: boolean;
  /** A translation exists already, so this one replaces it. */
  replaces: boolean;
}>();
const emit = defineEmits<{ translate: [provider: LlmProviderId, model: string]; cancel: [] }>();

const settings = useSettingsStore();
const translation = useTranslationStore();
const id = useId();
const ids = { model: `${id}-model` };

const PROVIDERS: readonly {
  id: LlmProviderId;
  label: string;
  keyLabel: string;
  company: string;
}[] = [
  { id: 'claude', label: 'Claude', keyLabel: 'Claude (Anthropic) API key', company: 'Anthropic' },
  { id: 'gemini', label: 'Gemini', keyLabel: 'Gemini (Google) API key', company: 'Google' },
];

const provider = ref<LlmProviderId>(settings.translationProvider);
const model = ref<string>(settings.translationModel);
/** Decided when the dialog opens or the provider changes, so the field stays while the key is typed. */
const keyNeeded = ref(false);
const dontShowAgain = ref(false);

const info = computed(() => PROVIDERS.find((p) => p.id === provider.value) ?? PROVIDERS[0]!);
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
    :message="replaces ? 'This replaces the English translation.' : ''"
    :confirm-label="replaces ? 'Re-translate' : 'Translate'"
    :confirm-disabled="keyMissing"
    @confirm="onConfirm"
    @cancel="emit('cancel')"
  >
    <div class="body">
      <fieldset class="providers">
        <legend class="visually-hidden">Provider</legend>
        <label v-for="p in PROVIDERS" :key="p.id" class="provider">
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

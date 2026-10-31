<script setup lang="ts">
import { computed, ref, useId, useSlots } from 'vue';
import { useSettingsStore, type KeyProvider } from '../../stores/settings';

// `verifiable` offers Verify key, where the provider has a check. Only Settings asks for it.
const props = withDefaults(
  defineProps<{ provider: KeyProvider; label: string; required?: boolean; verifiable?: boolean }>(),
  { required: false, verifiable: false },
);
defineSlots<{ help?: () => unknown }>();

const settings = useSettingsStore();
const slots = useSlots();
const id = useId();
const ids = {
  input: `${id}-key`,
  help: `${id}-help`,
};

const shown = ref(false);
const value = computed(() => settings.keyFor(props.provider));
const isEmpty = computed(() => value.value.trim() === '');
const canTest = computed(() => props.verifiable && settings.canTestKey(props.provider));
const check = computed(() => settings.keyChecks[props.provider]);

function onInput(event: Event): void {
  settings.setKey(props.provider, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="key-field">
    <label :for="ids.input" class="label">
      {{ label }}<span v-if="required" class="required"> (required)</span>
    </label>
    <div v-if="slots.help" :id="ids.help" class="hint"><slot name="help" /></div>

    <div class="row">
      <input
        :id="ids.input"
        class="control key-input"
        :type="shown ? 'text' : 'password'"
        :value="value"
        :required="required"
        :aria-describedby="slots.help ? ids.help : undefined"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @input="onInput"
      />
      <button
        type="button"
        class="button"
        :aria-pressed="shown"
        :aria-controls="ids.input"
        @click="shown = !shown"
      >
        Show key
      </button>
      <button
        v-if="canTest"
        type="button"
        class="button"
        :disabled="isEmpty || check.status === 'checking'"
        @click="settings.testKey(provider)"
      >
        Verify key
      </button>
    </div>

    <p v-if="canTest" class="check" role="status">
      <template v-if="check.status === 'checking'">Checking the key…</template>
      <span
        v-else-if="check.result"
        :class="check.result.ok ? 'check-ok' : 'check-bad'"
        data-testid="key-check"
      >
        <span aria-hidden="true">{{ check.result.ok ? '✓' : '✗' }}</span>
        {{ check.result.message }}
      </span>
    </p>
  </div>
</template>

<style scoped>
.key-field {
  display: grid;
  gap: var(--space-2);
}

.label {
  font-weight: 600;
}

.required {
  color: var(--color-text-muted);
  font-weight: 400;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.key-input {
  flex: 1 1 16rem;
  min-width: 0;
  font-family: var(--font-mono);
}

.check-ok {
  color: var(--color-success);
}

.check-bad {
  color: var(--color-danger);
}
</style>

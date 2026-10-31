<script setup lang="ts">
import { useId, useTemplateRef } from 'vue';
import { useModalDialog } from '../composables/useModalDialog';

// A modal confirmation on the native <dialog>. Usually driven by useConfirm():
// `<ConfirmDialog v-bind="dialog" />`. Content in the default slot (e.g. a choice) goes below the message.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message?: string;
    confirmLabel: string;
    danger?: boolean;
    /** Disables the confirm button, e.g. until a required field is filled. */
    confirmDisabled?: boolean;
  }>(),
  { message: '', danger: false, confirmDisabled: false },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const id = useId();
const ids = { title: `${id}-title`, message: `${id}-message` };
const dialogEl = useTemplateRef<HTMLDialogElement>('dialog');
const cancelButton = useTemplateRef<HTMLButtonElement>('cancelButton');
const confirmButton = useTemplateRef<HTMLButtonElement>('confirmButton');

const { onCancelEvent, onClose } = useModalDialog(dialogEl, () => props.open, {
  // Start on the safe choice when the action can't be undone.
  focusOnOpen: () => (props.danger ? cancelButton : confirmButton).value,
  onCancel: () => emit('cancel'),
});
</script>

<template>
  <dialog
    ref="dialog"
    class="confirm-dialog"
    :aria-labelledby="ids.title"
    :aria-describedby="message ? ids.message : undefined"
    @cancel="onCancelEvent"
    @close="onClose"
  >
    <h2 :id="ids.title" class="title">{{ title }}</h2>
    <p v-if="message" :id="ids.message" class="message">{{ message }}</p>
    <slot />
    <div class="actions">
      <button ref="cancelButton" type="button" class="button" @click="emit('cancel')">
        Cancel
      </button>
      <button
        ref="confirmButton"
        type="button"
        class="button"
        :class="danger ? 'button-danger' : 'button-primary'"
        :disabled="confirmDisabled"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-dialog {
  width: min(28rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

.confirm-dialog::backdrop {
  background: var(--color-backdrop);
}

.title {
  margin-bottom: var(--space-3);
  font-size: var(--font-size-lg);
}

/* Space before slot content; with no slot it collapses into the actions' larger top margin. */
.message {
  margin-bottom: var(--space-4);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>

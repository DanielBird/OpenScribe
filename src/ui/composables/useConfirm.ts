import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** A red confirm button, with focus starting on Cancel: for actions that can't be undone. */
  danger?: boolean;
}

interface PendingConfirm {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirmation. The calling component renders `<ConfirmDialog v-bind="dialog" />`
 * and awaits `confirm({ … })`, which resolves `true` on confirm and `false` on Cancel or Escape.
 * A new request, or the component unmounting, resolves a pending one with `false`.
 */
export function useConfirm() {
  const pending = shallowRef<PendingConfirm | null>(null);
  // Kept after the dialog closes, so its text doesn't blank out while it disappears.
  const options = shallowRef<ConfirmOptions>({ title: '', message: '', confirmLabel: 'OK' });

  function settle(ok: boolean): void {
    const request = pending.value;
    pending.value = null;
    request?.resolve(ok);
  }

  function confirm(next: ConfirmOptions): Promise<boolean> {
    settle(false);
    options.value = next;
    return new Promise((resolve) => {
      pending.value = { resolve };
    });
  }

  if (getCurrentScope()) onScopeDispose(() => settle(false));

  const dialog = computed(() => ({
    open: pending.value !== null,
    title: options.value.title,
    message: options.value.message,
    confirmLabel: options.value.confirmLabel,
    danger: options.value.danger ?? false,
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  }));

  return { confirm, dialog };
}

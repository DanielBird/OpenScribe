import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

/**
 * Drives a native modal `<dialog>` from an `open` value, for ConfirmDialog and BriefDialog.
 * Opening remembers the focused element and moves focus with `focusOnOpen`; closing returns focus to
 * that element. Escape, and Chromium closing the dialog itself, call `onCancel`: the owner closes the
 * dialog by setting `open` to false. Bind the returned handlers to the dialog's `cancel` and `close`.
 */
export function useModalDialog(
  dialog: Readonly<Ref<HTMLDialogElement | null>>,
  isOpen: () => boolean,
  options: { focusOnOpen: () => HTMLElement | null | undefined; onCancel: () => void },
) {
  let returnFocusTo: HTMLElement | null = null;

  function show(): void {
    const el = dialog.value;
    if (!el || el.open) return;
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.showModal();
    options.focusOnOpen()?.focus();
  }

  function hide(): void {
    const el = dialog.value;
    if (el?.open) el.close();
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target?.isConnected) target.focus();
  }

  watch(isOpen, (open) => (open ? show() : hide()), { flush: 'post' });

  onMounted(() => {
    if (isOpen()) show();
  });

  onBeforeUnmount(hide);

  // Escape fires `cancel`; the owner decides whether the dialog closes.
  function onCancelEvent(event: Event): void {
    event.preventDefault();
    options.onCancel();
  }

  // Chromium may close the dialog itself (a repeated Escape can't be prevented). Treat that as Cancel. The event
  // comes a moment after the close: if the dialog has been opened again since (Escape, then Enter at once), it's
  // the earlier close's, and is ignored.
  function onClose(): void {
    if (isOpen() && !dialog.value?.open) options.onCancel();
  }

  return { onCancelEvent, onClose };
}

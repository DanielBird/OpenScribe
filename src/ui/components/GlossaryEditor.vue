<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import type { TermIssue } from '../../domain/glossary';
import { useGlossaryStore } from '../../stores/glossary';
import { writeClipboard } from '../clipboard';
import { useConfirm } from '../composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';

const glossary = useGlossaryStore();
const { confirm, dialog } = useConfirm();
const id = useId();
const ids = {
  add: `${id}-add`,
  addHint: `${id}-add-hint`,
  listTitle: `${id}-list-title`,
  edit: `${id}-edit`,
  editError: `${id}-edit-error`,
  copy: `${id}-copy`,
  copyHint: `${id}-copy-hint`,
};

const root = useTemplateRef<HTMLElement>('root');
const addInput = useTemplateRef<HTMLTextAreaElement>('addInput');
const copyButton = useTemplateRef<HTMLButtonElement>('copyButton');
const copyArea = useTemplateRef<HTMLTextAreaElement>('copyArea');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The status region: results of add, delete, copy and clear. Add results are for screen readers
 * only; sighted users see the list grow.
 */
const status = ref({ text: '', visible: true });

function announce(text: string, { visible = true } = {}): void {
  status.value = { text, visible };
}

// --- Skipped terms ------------------------------------------------------------------------------

const limits = glossary.limits;
const forbiddenChars = [...limits.forbiddenChars];
const ISSUE_TEXT: Record<TermIssue, string> = {
  too_long: `${limits.maxChars + 1} characters or more`,
  too_many_words: `more than ${limits.maxWords} words`,
  unsupported_chars: `contains ${forbiddenChars.slice(0, -1).join(' ')} or ${forbiddenChars.at(-1)}`,
};

/** Why each skipped term is skipped. Terms are unique, so they can be the keys. */
const skipReasons = computed(() => {
  const reasons = new Map<string, string>();
  const { invalid, overLimit } = glossary.validation;
  for (const { term, issues } of invalid) {
    reasons.set(term, issues.map((issue) => ISSUE_TEXT[issue]).join('; '));
  }
  for (const term of overLimit) reasons.set(term, `over the limit of ${limits.maxTerms} terms`);
  return reasons;
});

/** The summary of the skipped list; the reasons open beneath it. */
const skippedNotice = computed(() => {
  const n = skipReasons.value.size;
  return n === 0 ? '' : `${plural(n, 'term', 'terms')} will be skipped`;
});

// --- Add ----------------------------------------------------------------------------------------

const draft = ref('');
const canAdd = computed(() => draft.value.trim() !== '');

function add(): void {
  if (!canAdd.value) return;
  const { added, duplicates } = glossary.addFromText(draft.value);
  draft.value = '';
  if (added === 0 && duplicates === 0) announce('No terms found.');
  else if (duplicates === 0) announce(`Added ${added}`, { visible: false });
  else {
    const skipped = plural(duplicates, 'duplicate', 'duplicates');
    announce(`Added ${added} · skipped ${skipped}`, { visible: false });
  }
}

// --- Edit and delete ----------------------------------------------------------------------------

const EDIT_ERRORS = {
  empty: "A term can't be empty. Press Escape to keep the old one.",
  duplicate: 'That term is already in the list.',
} as const;

const editingIndex = ref<number | null>(null);
const editValue = ref('');
const editError = ref('');

/** Focuses a row's Edit or Delete button after the DOM has updated. */
async function focusRowButton(index: number, action: 'edit' | 'delete'): Promise<void> {
  await nextTick();
  root.value
    ?.querySelector<HTMLButtonElement>(`[data-index="${index}"] [data-action="${action}"]`)
    ?.focus();
}

function stopEditing(): void {
  editingIndex.value = null;
  editError.value = '';
}

async function startEdit(index: number): Promise<void> {
  // Starting on another row drops an edit that was left open with an error.
  editingIndex.value = index;
  editValue.value = glossary.terms[index] ?? '';
  editError.value = '';
  await nextTick();
  const input = root.value?.querySelector<HTMLInputElement>('.edit-input');
  input?.focus();
  input?.select();
}

/** Saves the edit. Returns false, and keeps editing with an error, if the value is rejected. */
function commitEdit(): boolean {
  const index = editingIndex.value;
  if (index === null) return true;
  const result = glossary.updateTerm(index, editValue.value);
  if (!result.ok) {
    editError.value = EDIT_ERRORS[result.reason];
    return false;
  }
  stopEditing();
  return true;
}

async function onEditEnter(): Promise<void> {
  const index = editingIndex.value;
  if (index !== null && commitEdit()) await focusRowButton(index, 'edit');
}

async function cancelEdit(): Promise<void> {
  const index = editingIndex.value;
  stopEditing();
  if (index !== null) await focusRowButton(index, 'edit');
}

// Enter and Escape end editing first, so the blur that follows when the input disappears is a no-op.
// A rejected value keeps the row in edit mode, but focus is not pulled back.
function onEditBlur(): void {
  if (editingIndex.value !== null) commitEdit();
}

async function remove(index: number): Promise<void> {
  const term = glossary.terms[index];
  if (term === undefined) return;
  stopEditing(); // indexes shift
  glossary.removeTerm(index);
  announce(`Deleted ${term}.`);
  if (glossary.count === 0) {
    await nextTick();
    addInput.value?.focus();
  } else {
    await focusRowButton(Math.min(index, glossary.count - 1), 'delete');
  }
}

// --- Copy and clear -----------------------------------------------------------------------------

/** Shown when the clipboard can't be written: the list, selected, for Ctrl+C. */
const showCopyFallback = ref(false);
const listText = computed(() => glossary.terms.join('\n'));

async function copyList(): Promise<void> {
  if (await writeClipboard(listText.value)) {
    showCopyFallback.value = false;
    announce(`Copied ${plural(glossary.count, 'term', 'terms')}.`);
  } else {
    showCopyFallback.value = true;
    announce("Couldn't copy automatically. The list is selected: press Ctrl+C to copy it.");
    await nextTick();
    copyArea.value?.focus();
    copyArea.value?.select();
  }
}

async function closeCopyFallback(): Promise<void> {
  showCopyFallback.value = false;
  await nextTick();
  copyButton.value?.focus();
}

async function clearAll(): Promise<void> {
  const n = glossary.count;
  const ok = await confirm({
    title: 'Clear the glossary?',
    message: `${n === 1 ? 'Remove the 1 term' : `Remove all ${n} terms`}? This can't be undone.`,
    confirmLabel: 'Remove all',
    danger: true,
  });
  if (!ok) return;
  stopEditing();
  showCopyFallback.value = false;
  glossary.clear();
  announce('Removed all terms.');
  await nextTick();
  addInput.value?.focus();
}
</script>

<template>
  <div ref="root" class="glossary-editor">
    <div class="composer-wrap">
      <div class="composer">
        <label :for="ids.add" class="visually-hidden">Add terms</label>
        <textarea
          :id="ids.add"
          ref="addInput"
          v-model="draft"
          class="composer-input"
          rows="2"
          placeholder="Add terms, one per line or separated by commas"
          :aria-describedby="ids.addHint"
          aria-keyshortcuts="Control+Enter"
          @keydown.ctrl.enter.prevent="add"
        />
        <div class="composer-bar">
          <p :id="ids.addHint" class="hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to add</p>
          <button type="button" class="button" :disabled="!canAdd" @click="add">Add</button>
        </div>
      </div>
      <p class="status" :class="{ 'visually-hidden': !status.visible }" role="status">
        {{ status.text }}
      </p>
      <p v-if="glossary.saveFailed" class="notice-warning">
        This browser isn't saving the glossary, so it will be lost when you close the tab.
      </p>
    </div>

    <section v-if="glossary.count > 0" class="terms" :aria-labelledby="ids.listTitle">
      <div class="terms-header">
        <h2 :id="ids.listTitle">{{ plural(glossary.count, 'term', 'terms') }}</h2>
        <button ref="copyButton" type="button" class="quiet" @click="copyList">Copy list</button>
        <button type="button" class="quiet quiet-danger" @click="clearAll">Clear all</button>
      </div>

      <details v-if="skippedNotice" class="skip-list">
        <summary>{{ skippedNotice }}</summary>
        <ul>
          <li v-for="[term, reason] in skipReasons" :key="term">
            <span class="skip-term">{{ term }}</span
            >: {{ reason }}
          </li>
        </ul>
      </details>

      <div v-if="showCopyFallback" class="copy-fallback">
        <label :for="ids.copy" class="label">Glossary list</label>
        <textarea
          :id="ids.copy"
          ref="copyArea"
          class="control"
          rows="6"
          readonly
          :value="listText"
          :aria-describedby="ids.copyHint"
        />
        <div class="copy-actions">
          <p :id="ids.copyHint" class="hint">Press Ctrl+C to copy the selected list.</p>
          <button type="button" class="button" @click="closeCopyFallback">Close</button>
        </div>
      </div>

      <ul class="chips">
        <li
          v-for="(term, index) in glossary.terms"
          :key="term"
          :data-index="index"
          class="chip"
          :class="{ skipped: skipReasons.has(term), editing: editingIndex === index }"
        >
          <template v-if="editingIndex === index">
            <label :for="ids.edit" class="visually-hidden">Edit term</label>
            <input
              :id="ids.edit"
              v-model="editValue"
              class="control edit-input"
              :aria-invalid="editError ? 'true' : undefined"
              :aria-describedby="editError ? ids.editError : undefined"
              autocomplete="off"
              @keydown.enter.prevent="onEditEnter"
              @keydown.escape.prevent="cancelEdit"
              @blur="onEditBlur"
            />
            <p v-if="editError" :id="ids.editError" class="edit-error">{{ editError }}</p>
          </template>
          <template v-else>
            <button
              type="button"
              class="chip-term"
              data-action="edit"
              :aria-label="`Edit term ${term}${skipReasons.has(term) ? ' (skipped)' : ''}`"
              @click="startEdit(index)"
            >
              <svg
                v-if="skipReasons.has(term)"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M8 2.5 14 13.5H2Z" />
                <path d="M8 6.75v3" />
                <path d="M8 11.75v0.01" />
              </svg>
              {{ term }}
            </button>
            <button
              type="button"
              class="chip-remove"
              data-action="delete"
              :aria-label="`Delete term ${term}`"
              @click="remove(index)"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </template>
        </li>
      </ul>
    </section>
    <p v-else class="empty">
      A glossary is optional, but it can help the transcription spell product names and jargon
      correctly.
    </p>

    <ConfirmDialog v-bind="dialog" />
  </div>
</template>

<style scoped>
.glossary-editor {
  display: grid;
  gap: var(--space-6);
}

.label {
  font-weight: 600;
}

/* --- Add --------------------------------------------------------------------------------------- */

.composer-wrap {
  display: grid;
  gap: var(--space-2);
}

/* The textarea is a filled well like Setup's drop zone, and grows with what's typed or pasted. The
   shortcut and Add sit in its bottom padding. While typing, the well rings in the accent colour. */
.composer {
  position: relative;
}

.composer-input {
  display: block;
  width: 100%;
  min-height: 8rem;
  max-height: 50vh;
  padding: var(--space-4) var(--space-4) 4rem;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  resize: none;
  field-sizing: content;
  box-shadow: inset 0 0 0 2px transparent;
  transition:
    box-shadow 0.2s ease-out,
    background-color 0.2s ease-out;
}

.composer:hover .composer-input {
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
}

.composer:focus-within .composer-input {
  background: var(--color-bg);
}

.composer-input:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent);
}

.composer-input::placeholder {
  color: var(--color-text-muted);
  opacity: 1;
}

/* Clicks on the hint reach the textarea beneath it. */
.composer-bar {
  position: absolute;
  inset: auto var(--space-4) var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  pointer-events: none;
}

.composer-bar .button {
  pointer-events: auto;
}

kbd {
  padding: 0 0.35em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  font: inherit;
}

.status:empty {
  display: none;
}

.notice-warning {
  color: var(--color-warning);
  font-weight: 600;
}

/* --- Terms ------------------------------------------------------------------------------------- */

.terms {
  display: grid;
  gap: var(--space-4);
}

.terms-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-4);
}

.terms-header h2 {
  margin-right: auto;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.quiet {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: color 0.15s;
}

.quiet:hover {
  color: var(--color-accent);
}

.quiet-danger:hover {
  color: var(--color-danger);
}

/* Chevron drawn like Setup's: down when closed, up when open. */
.skip-list summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-warning);
  font-weight: 600;
  cursor: pointer;
}

.skip-list summary::after {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

.skip-list[open] summary::after {
  transform: translateY(25%) rotate(-135deg);
}

.skip-list ul {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  list-style: none;
}

.skip-term {
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.copy-fallback {
  display: grid;
  gap: var(--space-2);
}

.copy-fallback textarea {
  width: 100%;
  font-family: var(--font-mono);
}

.copy-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.chip {
  display: inline-flex;
  max-width: 100%;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  box-shadow: inset 0 0 0 1px var(--color-border);
  transition: box-shadow 0.15s ease-out;
}

.chip:hover {
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
}

.chip-term,
.chip-remove {
  border: 0;
  border-radius: inherit;
  background: none;
  color: inherit;
}

.chip-term {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
  text-align: left;
  overflow-wrap: anywhere;
  cursor: text;
}

.chip-remove {
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 0.15s;
}

.chip-remove:hover {
  color: var(--color-danger);
}

.chip svg {
  flex: none;
  width: 1rem;
  height: 1rem;
}

.chip.skipped {
  background: var(--color-warning-bg);
  box-shadow: inset 0 0 0 1px var(--color-warning);
  color: var(--color-warning);
}

/* The chip being edited takes the whole line. */
.chip.editing {
  display: grid;
  flex-basis: 100%;
  gap: var(--space-1);
  background: none;
  box-shadow: none;
}

.edit-input {
  width: 100%;
}

.edit-input[aria-invalid='true'] {
  border-color: var(--color-danger);
}

.edit-error {
  color: var(--color-danger);
  font-size: var(--font-size-sm);
}

.empty {
  color: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .composer-input,
  .quiet,
  .chip,
  .chip-remove,
  .skip-list summary::after {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { formatBytes, type FileCheck } from '../../domain/filecheck';
import { formatTimestamp } from '../../domain/transcript';

// Presentational: the parent owns the file and its check (Setup uses the settings store).
// `compact` is a one-line picker (`prompt`, if any, and a `chooseLabel` button) with no file details:
// AudioBar's Attach.
const props = withDefaults(
  defineProps<{
    file?: File | null;
    durationSec?: number | null;
    probing?: boolean;
    check?: FileCheck | null;
    compact?: boolean;
    prompt?: string;
    chooseLabel?: string;
  }>(),
  {
    file: null,
    durationSec: null,
    probing: false,
    check: null,
    compact: false,
    prompt: 'Drag an audio or video file here, or',
    chooseLabel: 'Choose file…',
  },
);
const emit = defineEmits<{ select: [file: File]; remove: [] }>();

const ACCEPT = 'audio/*,video/*,.m4a,.wma,.mkv,.opus';

const input = useTemplateRef<HTMLInputElement>('input');
const chooseButton = useTemplateRef<HTMLButtonElement>('chooseButton');
const dragging = ref(false);
let dragDepth = 0;

const durationText = computed(() => {
  if (props.probing) return 'Checking…';
  return props.durationSec === null ? 'unknown' : formatTimestamp(props.durationSec);
});

function choose(): void {
  input.value?.click();
}

function onChange(): void {
  const el = input.value;
  const picked = el?.files?.[0];
  // Reset so that choosing the same file again still fires `change`.
  if (el) el.value = '';
  if (picked) emit('select', picked);
}

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

function onDragEnter(event: DragEvent): void {
  if (!carriesFiles(event)) return;
  dragDepth++;
  dragging.value = true;
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  dragDepth = 0;
  dragging.value = false;
  const dropped = event.dataTransfer?.files[0];
  if (dropped) emit('select', dropped);
}

async function remove(): Promise<void> {
  emit('remove');
  // The Remove button disappears with the file; keep focus in the picker.
  await nextTick();
  chooseButton.value?.focus();
}

// A file dropped next to the zone would make the browser open it and leave the app.
function blockStrayDrop(event: DragEvent): void {
  if (event.defaultPrevented) return; // handled by the zone
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
}

onMounted(() => {
  window.addEventListener('dragover', blockStrayDrop);
  window.addEventListener('drop', blockStrayDrop);
});

onBeforeUnmount(() => {
  window.removeEventListener('dragover', blockStrayDrop);
  window.removeEventListener('drop', blockStrayDrop);
});
</script>

<template>
  <div class="file-drop">
    <input ref="input" type="file" :accept="ACCEPT" hidden @change="onChange" />

    <div
      class="zone"
      :class="{ 'is-dragging': dragging, 'is-compact': compact }"
      data-testid="drop-zone"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <template v-if="file && !compact">
        <dl class="details">
          <div>
            <dt>File</dt>
            <dd class="name">{{ file.name }}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{{ formatBytes(file.size) }}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{{ durationText }}</dd>
          </div>
        </dl>
        <div class="actions">
          <button ref="chooseButton" type="button" class="button" @click="choose">
            Choose another file…
          </button>
          <button type="button" class="button" @click="remove">Remove</button>
        </div>
      </template>
      <template v-else>
        <p v-if="prompt" class="prompt">{{ prompt }}</p>
        <button ref="chooseButton" type="button" class="button" @click="choose">
          {{ chooseLabel }}
        </button>
      </template>
    </div>

    <div v-if="!compact" class="issues" role="status">
      <ul v-if="check && (check.errors.length > 0 || check.warnings.length > 0)">
        <li v-for="error in check.errors" :key="error" class="error">
          <span class="visually-hidden">Error: </span>{{ error }}
        </li>
        <li v-for="warning in check.warnings" :key="warning" class="warning">
          <span class="visually-hidden">Warning: </span>{{ warning }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.file-drop {
  display: grid;
  gap: var(--space-2);
}

/* A filled well; a dragged file rings it in the accent colour. */
.zone {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  padding: var(--space-5);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: inset 0 0 0 2px transparent;
  transition:
    box-shadow 0.2s ease-out,
    background-color 0.2s ease-out;
  --color-button: var(--color-bg);
}

.zone.is-dragging {
  background: var(--color-bg);
  --color-button: var(--color-surface);
  box-shadow: inset 0 0 0 2px var(--color-accent);
}

.zone.is-compact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3);
}

@media (prefers-reduced-motion: reduce) {
  .zone {
    transition: none;
  }
}

.prompt {
  color: var(--color-text-muted);
}

.details {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.details div {
  display: flex;
  gap: var(--space-3);
}

.details dt {
  min-width: 5rem;
  color: var(--color-text-muted);
}

.details dd {
  margin: 0;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.issues ul {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-5);
}

.error {
  color: var(--color-danger);
}

.warning {
  color: var(--color-warning);
}
</style>

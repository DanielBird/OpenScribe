<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { STEPS, useNavStore, type Step } from '../../stores/nav';
import { useProjectStore } from '../../stores/project';
import ProjectHeader from './ProjectHeader.vue';

const nav = useNavStore();
const project = useProjectStore();
const LABELS: Record<Step, string> = {
  setup: 'Setup',
  glossary: 'Glossary',
  output: 'Output',
};

/** How long the row takes to swap one page's name for the next. */
const SWAP_MS = 260;

/** The page the row names: Home, a Transcribe step, the project or Settings. */
const page = computed(() => (nav.mode === 'transcribe' ? nav.step : nav.mode));
/** The path's last place: Home is 0 and its separator 1, then the page (2), or the steps and their separators. */
const last = computed(() => {
  if (nav.mode === 'home') return 0;
  return nav.mode === 'transcribe' ? 2 * STEPS.length : 2;
});

const headerEl = useTemplateRef<HTMLElement>('header');

// A page change swaps the names together, rather than one place after another. Opening Transcribe or Analyse from
// Home doesn't: its page's name is simply there, where it rests.
const swapping = ref(false);
const instant = ref(false);
let swapTimer: ReturnType<typeof setTimeout> | undefined;
watch(page, async (_, from) => {
  if (from === 'home') {
    instant.value = true;
    await nextTick();
    // Anything still folding away from the page before Home ends now, and reading the row's size applies its new
    // places at once; after that it moves as usual.
    for (const animation of headerEl.value?.getAnimations({ subtree: true }) ?? []) {
      animation.finish();
    }
    void headerEl.value?.offsetWidth;
    instant.value = false;
    return;
  }
  swapping.value = true;
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => (swapping.value = false), SWAP_MS);
});
onBeforeUnmount(() => clearTimeout(swapTimer));

/** What's leaving with the page can't be clicked or read out while it folds away. */
function leaving(el: Element): void {
  el.setAttribute('inert', '');
  el.setAttribute('aria-hidden', 'true');
}
</script>

<template>
  <!-- The top row, on every page. It names the current page; with the pointer over it (or the keyboard in it), it
       unfolds to the whole path: Home, then Transcribe's steps, the project's name or Settings (DECISIONS.md D32).
       The project's controls sit at the end once it's open. -->
  <header
    ref="header"
    class="app-header"
    :class="{ pinned: nav.mode === 'transcribe' && nav.step === 'output', swapping, instant }"
    :style="{ '--last': last, '--swap-ms': `${SWAP_MS}ms` }"
  >
    <!-- One place for Home on every page, so it folds rather than being replaced. Grey on Home, like a step that
         isn't current: the tiles below carry the accent. -->
    <span class="slot" :class="{ fold: nav.mode !== 'home' }" style="--at: 0">
      <span v-if="nav.mode === 'home'" class="step" aria-current="page">Home</span>
      <button v-else type="button" class="step" @click="nav.goHome()">Home</button>
    </span>
    <Transition name="swap" :css="!instant" @before-leave="leaving">
      <span v-if="nav.mode !== 'home'" class="slot fold" style="--at: 1" aria-hidden="true">
        <span class="separator">/</span>
      </span>
    </Transition>
    <Transition name="swap" :css="!instant" @before-leave="leaving">
      <nav v-if="nav.mode === 'transcribe'" aria-label="Steps">
        <ol>
          <li v-for="(s, i) in STEPS" :key="s">
            <span v-if="i > 0" class="slot fold" :style="{ '--at': 2 * i + 1 }" aria-hidden="true">
              <span class="separator">/</span>
            </span>
            <span class="slot" :class="{ fold: nav.step !== s }" :style="{ '--at': 2 * i + 2 }">
              <button
                type="button"
                class="step"
                :aria-current="nav.step === s ? 'step' : undefined"
                :disabled="!nav.canEnter(s)"
                @click="nav.goTo(s)"
              >
                {{ LABELS[s] }}
              </button>
            </span>
          </li>
        </ol>
      </nav>
      <span
        v-else-if="nav.mode === 'project'"
        class="step current project-name"
        aria-current="page"
      >
        {{ project.projectName ?? 'Analyse' }}
      </span>
      <span v-else-if="nav.mode === 'settings'" class="step current" aria-current="page">
        Settings
      </span>
    </Transition>
    <ProjectHeader
      v-if="nav.mode === 'project' && project.status === 'ready'"
      class="project-controls"
    />
  </header>
</template>

<style scoped>
/* On Output, the steps stay at the top of the window while the transcript scrolls under them. */
.pinned {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg);
}

/* Describe and the steps read as one path, left to right. */
.app-header,
ol {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
}

.app-header {
  /* The path opens from the left, one place after another, after a pause so that a pointer passing over doesn't
     open it, and closes from the right. */
  --fold-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --fold-shift: calc(-1 * var(--space-2));
  --open-wait: 60ms;
  --open-stagger: 30ms;
  --open-ms: 280ms;
  --close-wait: 120ms;
  --close-stagger: 25ms;
  --close-ms: 220ms;
  padding-bottom: var(--space-2);
  /* Lets a place's width move between 0 and max-content (Chromium doesn't interpolate a flex item's auto). */
  interpolate-size: allow-keywords;
}

/* A place in the path. It's clipped so it can fold to nothing; the margin leaves room for the focus ring (2px offset
   + 2px outline), and Chromium only honours it when both axes clip. Its text fades with its width unless a rule
   below says otherwise. */
.slot {
  --fold-delay: 0ms;
  --fold-ms: var(--swap-ms);
  --fade-delay: var(--fold-delay);
  --fade-ms: var(--fold-ms);
  display: flex;
  width: max-content;
  align-items: baseline;
  overflow: clip;
  overflow-clip-margin: 4px;
  white-space: nowrap;
  transition:
    width var(--fold-ms) var(--fold-ease) var(--fold-delay),
    opacity var(--fade-ms) var(--fold-ease) var(--fade-delay),
    translate var(--fold-ms) var(--fold-ease) var(--fold-delay);
}

/* Without a pointer that hovers, the whole path shows. */
@media (hover: hover) {
  /* Closed: every place but the current page folds away, last place first. Its text is gone before its width, so
     no sliver of it lingers at the edge. */
  .fold {
    --fold-delay: calc(var(--close-wait) + (var(--last) - var(--at)) * var(--close-stagger));
    --fold-ms: var(--close-ms);
    --fade-ms: calc(var(--close-ms) * 0.6);
    width: 0;
    opacity: 0;
    translate: var(--fold-shift) 0;
  }

  /* Open while the pointer is over the row (but not Analyse's controls) or the keyboard is in the path; a mouse
     click doesn't keep it open. A place coming or going with the page folds even then. */
  .app-header:hover:not(:has(.project-controls:hover))
    .fold:not(.swap-enter-from, .swap-leave-active),
  .app-header:has(.slot :focus-visible) .fold:not(.swap-enter-from, .swap-leave-active) {
    --fold-delay: calc(var(--open-wait) + var(--at) * var(--open-stagger));
    --fold-ms: var(--open-ms);
    width: max-content;
    opacity: 1;
    translate: none;
  }
}

/* The old page's name folds away as the new one takes its place. The old one fades out first and the new one fades
   in a moment later, so the two never read as one word. */
.swapping .slot {
  --fold-delay: 0ms;
  --fold-ms: var(--swap-ms);
  --fade-delay: calc(var(--swap-ms) * 0.25);
  --fade-ms: calc(var(--swap-ms) * 0.75);
}

.swapping .fold {
  --fade-delay: 0ms;
  --fade-ms: calc(var(--swap-ms) * 0.5);
}

.instant .slot {
  transition: none;
}

/* The steps, or a page's name, coming and going with the page, timed as above. */
.swap-enter-active,
.swap-leave-active {
  width: max-content;
  overflow: clip;
  overflow-clip-margin: 4px;
  white-space: nowrap;
}

.swap-enter-active {
  transition:
    width var(--swap-ms) var(--fold-ease),
    opacity calc(var(--swap-ms) * 0.75) var(--fold-ease) calc(var(--swap-ms) * 0.25),
    translate var(--swap-ms) var(--fold-ease);
}

.swap-leave-active {
  transition:
    width var(--swap-ms) var(--fold-ease),
    opacity calc(var(--swap-ms) * 0.5) var(--fold-ease),
    translate var(--swap-ms) var(--fold-ease);
}

/* The steps stay on one line while their width moves; wrapping would make the row taller until they've gone. */
.swap-enter-active ol,
.swap-leave-active ol {
  flex-wrap: nowrap;
}

.swap-enter-from,
.swap-leave-to {
  width: 0;
  opacity: 0;
  translate: var(--fold-shift) 0;
}

/* A long project name wraps rather than pushing the controls off the row. */
.project-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The controls sit at the end of the row, and wrap under the name in a narrow window. */
.project-controls {
  margin-left: auto;
  padding-left: var(--space-5);
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  align-items: baseline;
}

.separator {
  padding-inline: var(--space-5);
  color: var(--color-border-strong);
  font-size: var(--font-size-xl);
  font-weight: 300;
  line-height: 1.25;
  user-select: none;
}

/* The steps double as the page titles (the views' h1s are visually hidden), so they use the h1 size.
   One weight for every state, so the path doesn't shift when the current step changes. */
.step {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xl);
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

button.step {
  cursor: pointer;
  transition: color 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.step:hover:not(:disabled),
.step[aria-current='step'],
.current {
  color: var(--color-accent);
}

.step:disabled {
  color: var(--color-disabled);
  cursor: not-allowed;
}

/* Keep the row on one line in narrow windows: at 375px it needs 388px at the lg size, against 343px
   (chosen by the maintainer in Phase 11). */
@media (max-width: 30rem) {
  .separator {
    padding-inline: var(--space-3);
  }

  .step,
  .separator {
    font-size: var(--font-size-md);
  }
}

@media (prefers-reduced-motion: reduce) {
  .slot,
  .swap-enter-active,
  .swap-leave-active {
    transition: none;
  }
}
</style>

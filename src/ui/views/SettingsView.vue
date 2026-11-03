<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue';
import ownLicence from '../../../LICENSE?raw';
import desktopNotices from '../../../THIRD-PARTY-NOTICES-DESKTOP.txt?raw';
import notices from '../../../THIRD-PARTY-NOTICES.txt?raw';
import { useNavStore } from '../../stores/nav';
import { useSavedDataStore } from '../../stores/savedData';
import { useSettingsStore } from '../../stores/settings';
import { useTranscriptStore } from '../../stores/transcript';
import ApiKeyField from '../components/ApiKeyField.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import StepFooter from '../components/StepFooter.vue';
import { useConfirm } from '../composables/useConfirm';

// Opened from the footer, from any mode: the API keys, saved data, and what is sent where (D27).
const settings = useSettingsStore();
const savedData = useSavedDataStore();
const transcript = useTranscriptStore();
const nav = useNavStore();
const { confirm, dialog: confirmDialog } = useConfirm();

const id = useId();
const ids = {
  rememberKeys: `${id}-remember-keys`,
  rememberKeysHelp: `${id}-remember-keys-help`,
  userName: `${id}-user-name`,
  userNameHelp: `${id}-user-name-help`,
};
const version = __APP_VERSION__;
const buildDate = __BUILD_DATE__;
/** The desktop app (D35) keeps its data in its own storage, not a browser's. */
const desktop = __DESKTOP__;
const keysEl = useTemplateRef<HTMLElement>('keys');

/**
 * DeScribe's licence, then the notices from scripts/make-notices.mjs. The Rust crates' are only in the desktop build:
 * `__DESKTOP__` is a literal there, so the web build drops them.
 */
const licences = [ownLicence, notices, ...(__DESKTOP__ ? [desktopNotices] : [])].join('\n\n');
/** The text is long, so it is rendered only while open. */
const licencesOpen = ref(false);

const hasKeys = computed(() =>
  Object.values(settings.keyLocations).some((where) => where !== null),
);

const LINKS = [
  {
    name: 'ElevenLabs',
    privacy: 'https://elevenlabs.io/privacy-policy',
    terms: 'https://elevenlabs.io/terms-of-use',
  },
  {
    name: 'Anthropic (Claude)',
    privacy: 'https://www.anthropic.com/legal/privacy',
    terms: 'https://www.anthropic.com/legal/commercial-terms',
  },
  {
    name: 'Google (Gemini)',
    privacy: 'https://policies.google.com/privacy',
    terms: 'https://ai.google.dev/gemini-api/terms',
  },
] as const;

/** For screen readers only: results that aren't visible where focus is. */
const announcement = ref('');

// The button disappears with the keys, so focus moves to the first key field.
async function forgetAllKeys(): Promise<void> {
  announcement.value = '';
  settings.forgetAllKeys();
  await nextTick();
  keysEl.value?.querySelector('input')?.focus();
  announcement.value = 'Keys forgotten.';
}

async function clearSavedData(): Promise<void> {
  announcement.value = '';
  const ok = await confirm({
    title: 'Clear saved data?',
    message:
      'This deletes your glossary, settings, last transcript and the link to your project from this ' +
      `${desktop ? 'app' : 'browser'}. Your API keys stay, and so do the project's files.` +
      (transcript.unsavedInProject
        ? " Your last transcript's latest changes aren't saved in its project."
        : ''),
    confirmLabel: 'Clear',
    danger: true,
  });
  if (!ok) return;
  await savedData.clearSavedData();
  announcement.value = 'Saved data cleared.';
}
</script>

<template>
  <section class="view" aria-labelledby="settings-title">
    <!-- The top row shows the title; this heading names the view and takes focus on a mode change. -->
    <h1 id="settings-title" class="visually-hidden" tabindex="-1">Settings</h1>

    <div class="sheet">
      <section class="band" aria-labelledby="settings-keys">
        <h2 id="settings-keys">API keys</h2>
        <div ref="keys" class="band-content">
          <ApiKeyField provider="elevenlabs" label="ElevenLabs API key" verifiable />
          <ApiKeyField provider="claude" label="Claude (Anthropic) API key" verifiable />
          <ApiKeyField provider="gemini" label="Gemini (Google) API key" verifiable />

          <div class="remember">
            <input
              :id="ids.rememberKeys"
              type="checkbox"
              :checked="settings.rememberKeys"
              :aria-describedby="ids.rememberKeysHelp"
              @change="settings.setRememberKeys(($event.target as HTMLInputElement).checked)"
            />
            <label :for="ids.rememberKeys">Remember keys on this computer</label>
            <p :id="ids.rememberKeysHelp" class="hint">
              <template v-if="!desktop"
                >Any web page you open from a file on this computer can read them.</template
              >
              Leave unticked on shared computers.
            </p>
          </div>

          <div v-if="hasKeys">
            <button type="button" class="button" @click="forgetAllKeys">Forget all keys</button>
          </div>
        </div>
      </section>

      <section class="band" aria-labelledby="settings-chats">
        <h2 id="settings-chats">Chats</h2>
        <div class="band-content">
          <div class="name-field">
            <label :for="ids.userName" class="label">Your name</label>
            <input
              :id="ids.userName"
              v-model="settings.userName"
              type="text"
              class="control"
              :placeholder="settings.generatedName"
              :aria-describedby="ids.userNameHelp"
              autocomplete="name"
            />
            <p :id="ids.userNameHelp" class="hint">
              Colleagues see it on the chats you save in a project.
            </p>
          </div>
        </div>
      </section>

      <section class="band" aria-labelledby="settings-data">
        <h2 id="settings-data">Saved data</h2>
        <div class="band-content">
          <div>
            <button type="button" class="button" @click="clearSavedData">Clear saved data…</button>
          </div>
        </div>
      </section>

      <section class="band" aria-labelledby="settings-about">
        <h2 id="settings-about">About</h2>
        <div class="band-content">
          <p v-if="desktop">DeScribe runs on this computer and calls public APIs to use LLMs.</p>
          <p v-else>
            DeScribe primarily runs in your browser but makes calls to public APIs to make use of
            LLMs.
          </p>
          <div class="part">
            <h3>Getting API keys</h3>
            <ul class="list">
              <li>
                ElevenLabs, to transcribe: create one on the
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  >ElevenLabs API keys page</a
                >
                with Speech-to-Text access.
              </li>
              <li>
                Claude or Gemini, to translate and analyse: create one in the
                <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer"
                  >Claude Console</a
                >
                or
                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
                  >Google AI Studio</a
                >.
              </li>
            </ul>
          </div>
          <div class="part">
            <h3>Transcribe</h3>
            <p>
              Your recording and glossary are sent to ElevenLabs for transcription. If you choose
              <strong>Translate to English</strong>, the transcript text and glossary (not the
              audio) are sent to the provider you pick, Anthropic (Claude) or Google (Gemini), for
              translation.
            </p>
          </div>
          <div class="part">
            <h3>Analyse</h3>
            <p>
              If you add a session to a project, its transcript is saved in the project folder you
              chose. To translate and summarise a session, its text and the project brief are sent
              to the provider chosen for the project, Anthropic (Claude) or Google (Gemini). When
              you ask about a project, your question, the brief, the summaries and the transcript
              passages the model reads are sent to the same provider. Chats are saved in the project
              folder, where everyone who can open it can read them.
            </p>
          </div>
          <div class="part">
            <h3>{{ desktop ? 'On this computer' : 'In this browser' }}</h3>
            <p>
              Your API keys (when remember keys is selected), glossary, settings and last
              transcript, the link to your project folder, and a copy of the project's transcript
              text are saved
              {{
                desktop
                  ? "in DeScribe's own storage"
                  : "on this computer in your browser's storage"
              }}.
            </p>
          </div>
          <div class="part">
            <h3>Privacy and terms</h3>
            <ul class="list">
              <li v-for="link in LINKS" :key="link.name">
                {{ link.name }}:
                <a :href="link.privacy" target="_blank" rel="noopener noreferrer">privacy</a> ·
                <a :href="link.terms" target="_blank" rel="noopener noreferrer">terms</a>
              </li>
            </ul>
          </div>
          <details
            class="licences"
            @toggle="licencesOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary>Licences</summary>
            <pre v-if="licencesOpen" tabindex="0" aria-label="Licence texts">{{ licences }}</pre>
          </details>
          <p class="hint">v{{ version }} · built {{ buildDate }}</p>
        </div>
      </section>
    </div>

    <span class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</span>

    <StepFooter>
      <template #back>
        <button type="button" class="button" @click="nav.leaveSettings()">
          <svg
            class="step-arrow step-arrow-back"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M13 8H3M7 4 3 8l4 4" />
          </svg>
          Back
        </button>
      </template>
    </StepFooter>

    <ConfirmDialog v-bind="confirmDialog" />
  </section>
</template>

<style scoped>
/* Fills <main>, so the StepFooter can sit at the bottom of the window. */
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-6);
}

.remember {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}

.remember .hint {
  grid-column: 2;
}

.part,
.name-field {
  display: grid;
  gap: var(--space-2);
}

.name-field .label {
  font-weight: 600;
}

.name-field .control {
  max-width: 24rem;
}

h3 {
  margin: 0;
  font-size: var(--font-size-md);
}

.list {
  margin: 0;
  padding-left: var(--space-5);
}

/* A quiet label with Setup's chevron: down when closed, up when open. */
.licences summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}

.licences summary:hover {
  color: var(--color-accent);
}

.licences summary::after {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid;
  border-bottom: 1.5px solid;
  content: '';
  transform: translateY(-25%) rotate(45deg);
  transition: transform 0.2s ease-out;
}

.licences[open] summary::after {
  transform: translateY(25%) rotate(-135deg);
}

.licences pre {
  max-height: 24rem;
  margin: var(--space-2) 0 0;
  padding: var(--space-3);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

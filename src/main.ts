import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { useSpeechPackStore } from './stores/speechPack';
import { useTranscriptStore } from './stores/transcript';
import '@fontsource-variable/dm-sans/wght.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

const pinia = createPinia();
createApp(App).use(pinia).mount('#app');

// The last transcript comes back after a reload; Setup offers it (DECISIONS.md D10).
void useTranscriptStore(pinia).loadAutosave();

// The speech models' status, asked for while Home is open, so Setup knows the engine when it opens (audit BUG-6).
if (__DESKTOP__) void useSpeechPackStore(pinia).refresh();

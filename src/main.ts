import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { useTranscriptStore } from './stores/transcript';
import '@fontsource-variable/dm-sans/wght.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

const pinia = createPinia();
createApp(App).use(pinia).mount('#app');

// The last transcript comes back after a reload; Setup offers it (DECISIONS.md D10).
void useTranscriptStore(pinia).loadAutosave();

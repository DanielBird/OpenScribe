import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  mergeTerms,
  normalizeTerm,
  parseTerms,
  termKey,
  validateList,
  type KeytermLimits,
} from '../domain/glossary';
import { ELEVENLABS_LIMITS } from '../providers/transcription/elevenlabs/limits';
import { readJson, writeJson } from '../storage/local';

const GLOSSARY_KEY = 'glossary';

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

/** The saved list, cleaned up: a hand-edited or old list can't bring in empty or duplicate terms. */
function loadTerms(): string[] {
  const stored = readJson('local', GLOSSARY_KEY, [], isStringArray);
  return mergeTerms(
    [],
    stored.map(normalizeTerm).filter((t) => t !== ''),
  ).terms;
}

export type UpdateResult = { ok: true } | { ok: false; reason: 'empty' | 'duplicate' };

// One list of project terms, sent as ElevenLabs keyterms (DECISIONS.md D6). Saved after every change.
export const useGlossaryStore = defineStore('glossary', () => {
  const limits: KeytermLimits = ELEVENLABS_LIMITS.keyterms;
  const terms = ref<string[]>(loadTerms());
  /** True when the last save failed (storage unavailable or full): the list lasts only for this tab. */
  const saveFailed = ref(false);

  // Actions replace the array, so this sees every change, including plain assignments.
  watch(
    terms,
    (value) => {
      saveFailed.value = !writeJson('local', GLOSSARY_KEY, value);
    },
    { flush: 'sync' },
  );

  const validation = computed(() => validateList(terms.value, limits));
  /** What is sent to ElevenLabs: terms that break the limits are left out (one would fail the run). */
  const validTerms = computed(() => validation.value.valid);
  const count = computed(() => terms.value.length);

  function addFromText(raw: string): { added: number; duplicates: number } {
    const { terms: next, added, duplicates } = mergeTerms(terms.value, parseTerms(raw));
    if (added > 0) terms.value = next;
    return { added, duplicates };
  }

  function updateTerm(index: number, value: string): UpdateResult {
    if (index < 0 || index >= terms.value.length) return { ok: true };
    const term = normalizeTerm(value);
    if (term === '') return { ok: false, reason: 'empty' };
    const key = termKey(term);
    if (terms.value.some((t, i) => i !== index && termKey(t) === key)) {
      return { ok: false, reason: 'duplicate' };
    }
    if (terms.value[index] !== term) {
      terms.value = terms.value.map((t, i) => (i === index ? term : t));
    }
    return { ok: true };
  }

  function removeTerm(index: number): void {
    if (index < 0 || index >= terms.value.length) return;
    terms.value = terms.value.filter((_, i) => i !== index);
  }

  function clear(): void {
    terms.value = [];
  }

  return {
    terms,
    saveFailed,
    limits,
    validation,
    validTerms,
    count,
    addFromText,
    updateTerm,
    removeTerm,
    clear,
  };
});

<script setup lang="ts">
import { formatCitation } from '../../domain/corpus/citation';
import type { AnswerBlock } from '../../features/agent/answer';
import type { CorpusReader } from '../../features/agent/corpus';
import QuoteCard from './QuoteCard.vue';

// An answer from the project agent (PROJECTS.md §5.5), as template elements only. The model's text never becomes
// HTML (no v-html: the CSP allows inline script), so anything that looks like a tag shows as text.
defineProps<{
  blocks: readonly AnswerBlock[];
  /** The chat's corpus, for the session title of a quote that wasn't verified. */
  corpus: CorpusReader | null;
}>();
</script>

<template>
  <div class="answer-blocks">
    <template v-for="(block, i) in blocks" :key="i">
      <p v-if="block.kind === 'paragraph'">
        <template v-for="(inline, j) in block.inlines" :key="j">
          <strong v-if="inline.kind === 'bold'">{{ inline.text }}</strong>
          <em v-else-if="inline.kind === 'italic'">{{ inline.text }}</em>
          <template v-else>{{ inline.text }}</template>
        </template>
      </p>
      <h3 v-else-if="block.kind === 'heading'">
        <template v-for="(inline, j) in block.inlines" :key="j">
          <strong v-if="inline.kind === 'bold'">{{ inline.text }}</strong>
          <em v-else-if="inline.kind === 'italic'">{{ inline.text }}</em>
          <template v-else>{{ inline.text }}</template>
        </template>
      </h3>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'">
        <li v-for="(item, j) in block.items" :key="j">
          <template v-for="(inline, k) in item" :key="k">
            <strong v-if="inline.kind === 'bold'">{{ inline.text }}</strong>
            <em v-else-if="inline.kind === 'italic'">{{ inline.text }}</em>
            <template v-else>{{ inline.text }}</template>
          </template>
        </li>
      </component>
      <QuoteCard
        v-else-if="block.citation"
        :text="block.citation.text"
        check="verified"
        :speaker="block.citation.speakerLabel"
        :start="block.citation.start"
        :translated-from="block.citation.translatedFrom"
        :session-title="block.citation.sessionTitle"
        :citation="formatCitation(block.citation)"
      />
      <QuoteCard
        v-else
        :text="block.modelText"
        :check="block.check.status"
        :speaker="null"
        :start="null"
        :session-title="block.sessionId ? (corpus?.byId(block.sessionId)?.title ?? null) : null"
        :citation="null"
      />
    </template>
  </div>
</template>

<style scoped>
.answer-blocks {
  display: grid;
  gap: var(--space-3);
  line-height: var(--line-height);
}

h3 {
  margin-top: var(--space-2);
  font-size: var(--font-size-md);
  font-weight: 600;
}

ul,
ol {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-5);
}

p,
li {
  overflow-wrap: anywhere;
}
</style>

import { useNavStore } from '../../stores/nav';
import { usePipelineStore } from '../../stores/pipeline';
import { useTranscriptStore } from '../../stores/transcript';
import { useConfirm } from './useConfirm';

/** Where in the transcript to open: a quote's turn, in English when the quote is the translation. */
export interface OpenAt {
  turnId: string;
  english: boolean;
}

const OPEN_FAILED = "DeScribe couldn't open this transcript. Try again.";

// One confirmation for every **Open** (a summary's Open transcript, a quote's, a search hit's): ProjectView renders
// `<ConfirmDialog v-bind="openDialog" />` once, the way useProjectUi shares the project's view state.
const { confirm, dialog } = useConfirm();

/**
 * Opens a project session on Output, at a turn if `at` is given (PROJECTS.md §5.5, §5.6). A transcript that would lose
 * work is replaced only after the user agrees. Resolves with a message to show when it couldn't open, else `null`.
 */
async function openTranscript(sessionId: string, at?: OpenAt): Promise<string | null> {
  const transcript = useTranscriptStore();
  const nav = useNavStore();
  const current = transcript.doc;
  if (!(current?.id === sessionId && transcript.projectLink)) {
    if (current && (!transcript.projectLink || transcript.folderNotice)) {
      const ok = await confirm({
        title: 'Replace the transcript on Output?',
        message: transcript.projectLink
          ? "Its latest changes aren't saved in its project."
          : "It isn't in a project, and is saved only in this browser.",
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!ok) return null;
    }
    try {
      await transcript.openFromProject(sessionId);
    } catch (err) {
      return err instanceof Error && 'userMessage' in err && typeof err.userMessage === 'string'
        ? err.userMessage
        : OPEN_FAILED;
    }
  }
  if (at) transcript.showTurn(at.turnId, at.english);
  nav.goTo('output');
  return null;
}

/** Not while the pipeline is reading or writing the session's transcript. */
function canOpen(sessionId: string): boolean {
  return usePipelineStore().statusOf(sessionId) !== 'running';
}

export function useOpenTranscript() {
  return { openTranscript, canOpen, openDialog: dialog };
}

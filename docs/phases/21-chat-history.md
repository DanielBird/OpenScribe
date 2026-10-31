# Phase 21 — Chat history in the project folder

**Goal:** Every chat with the project agent is saved in the project folder, so a researcher can come back to it and
colleagues sharing the folder through OneDrive can read it. Analyse's sidebar lists the saved chats, the last one added
to first, and opens one again; a reopened chat goes on where it stopped.

**Status of the plan:** asked for by the maintainer on 2026-10-27; it replaces PROJECTS.md A9 and D22's "Chats are not
kept" (DECISIONS.md **D29**).

**Depends on:** Phases 14 (the project folder and its rescan), 16 (the `AgentProvider` contract), 17 (the chat) and
20 (Gemini for the agent).

**Read first:**
- [PROJECTS.md](../PROJECTS.md) §2 (A9), §5.2, §5.5, §5.6;
- [DECISIONS.md](../DECISIONS.md) D18, D22, D25, D29, T14;
- [reference/file-system-access.md](../reference/file-system-access.md): conflict copies (F10), writes (F12), Rules 3–8;
- [reference/llm-providers.md](../reference/llm-providers.md): "Project agent" and "Project agent with Gemini";
- the `claude-api` skill before touching `claudeAgent.ts` (CLAUDE.md).

## Agreed with the maintainer (2026-10-27)

- **Sidebar:** two tabs, **Sessions N | Chats N**. Search stays in the Sessions tab.
- **On open:** the chat pane starts with a new, empty chat. The list is ordered by last activity. As before, the
  chat in memory survives a change of mode within the tab.
- **Colleagues' chats** can be read in full. Asking a follow-up saves a **copy of your own** with the history, so two
  people never write the same file.
- **Names:** no prompt. **Your name** is an optional field in Settings. When it's empty, a randomly generated name is
  used, made once and kept in this browser.

## Decided in this file (the maintainer can still change them)

1. **One file per chat:** `chats/<YYYY-MM-DD-HHmm>--<id8>.chat.json`, from when it started, in UTC. The name never
   changes, and Explorer sorts the files by date. Conflict copies (`x.chat-LAPTOP.json`, `x.chat - Copy.json`) are
   recognised as for session files; of a chat's copies, the newest `updatedAt` wins.
2. **Only answers that ended are saved** (`done`, `limit`, `stopped`). An error stays in memory with **Try again**.
   The file is written after each answer, one save after another. A save that fails shows a notice with **Try
   again**, and runs again when access comes back.
3. **Answers are stored as text with their quote tags**, not as rendered blocks. Opening a chat parses them again, so
   quotes are checked against the transcripts as they are now.
4. **Session keys stay stable.** The file keeps `sessionKeys`; a reopened chat keeps them, and sessions added since
   get numbers after the highest one.
5. **Resuming sends plain text.** The provider's own conversation (thinking blocks, signatures, tool results) can't
   leave its provider (AGENTS.md rule 5). A reopened chat sends its questions and finished answers back as text
   (`AgentProvider.resume`). A stopped answer is left out with its question, as in a live chat.
6. **Identity:** `describe.v1.chatAuthor` holds `{ id, generatedName }`. A chat is yours when its `author.id` is this
   browser's. Each save writes the current name.

## Tasks

1. `domain/chat.ts`: the `ChatFile` type, names, the conflict-copy classifier, `chatTitle`, `exchangesOf`,
   `randomAuthorName`.
2. `domain/corpus/sessionKeys.ts` and `features/agent/corpus.ts`: fixed keys.
3. `providers/llm/types.ts`, `claudeAgent.ts`, `geminiAgent.ts`: `resume(history)`.
4. `storage/chatFiles.ts`: schema, list, read, write with the change check.
5. `stores/project.ts`: the chats, read after the sessions on load and on every rescan; `saveChat`.
6. `stores/settings.ts`: **Your name**, the chat identity, reset by **Clear saved data**.
7. `stores/chat.ts`: save, open, resume, copy a colleague's chat.
8. UI: the sidebar tabs (`ProjectView`), `ChatList`, `useRovingListbox` (shared with `SessionList`), the
   colleague line and the save notice in `ChatPane`, **Your name** in Settings, the About text.
9. Docs: D29, PROJECTS.md, ROADMAP, the reference doc, the User Guide, the changelog.

## Contracts introduced

```ts
// domain/chat.ts
export interface ChatFile {
  kind: 'describe.chat'; schemaVersion: 1;
  id: string; projectId: string; title: string;
  createdAt: string; updatedAt: string;          // updatedAt orders the list
  author: { id: string; name: string };
  forkedFrom: string | null;
  sessionKeys: Record<string, string>;           // sessionId → 's1'…
  messages: (ChatFileQuestion | ChatFileAnswer)[];
}

// providers/llm/types.ts (addition)
export interface AgentExchange { question: string; answer: string }
interface AgentProvider { resume(history: readonly AgentExchange[]): AgentConversation }

// stores/project.ts (additions)
chats: ProjectChat[]; chatProblems: FileProblem[]; chatsLoaded: boolean;
saveChat(file: ChatFile, expected: FileStat | null): Promise<ProjectChat>;

// stores/chat.ts (additions)
chatId: string | null; ownerName: string | null; saveError: string | null;
open(chat: ProjectChat): void; saveAgain(): Promise<void>;
```

## Live checks (pending until the maintainer runs them)

- **H1:** a resumed chat with Sonnet 5.5 and Opus 5.5 (an account created after 2026-08-31, so the preserved-thinking
  check is enforced): the earlier turns go back as text only, and the request is accepted.
- **H2:** the same with Gemini 3.8 Flash and 4 Argon.
- **H3:** two colleagues on one OneDrive folder: a chat appears on the other computer after sync and a focus, and
  continuing it writes a copy (TESTING.md's manual list, with Phase 18).

## Acceptance criteria

- [x] Asking a question writes `chats/<…>.chat.json` once its answer ends; each further answer updates the same file.
- [x] The Chats tab lists every chat in the folder, the last one added to first, with "You" or the colleague's name.
- [x] After a reload, the chat pane starts empty and the chat can be opened from the list, with its quotes checked.
- [x] A follow-up in an opened chat sends the earlier questions and answers as text, and saves to the same file.
- [x] A colleague's chat can be read; asking in it saves a new file with `forkedFrom`, and theirs is unchanged.
- [x] A colleague's new chat appears after a rescan; an unreadable chat file is listed under a `<details>`.
- [x] A failed save shows a notice with **Try again**; it is saved again when access comes back.
- [x] **Your name** in Settings is optional; without it, the made-up name is used.
- [x] Definition of Done in AGENTS.md. No real API calls; the live checks recorded as pending.

## Required tests

- `domain/chat.spec.ts`, `sessionKeys.spec.ts`, `features/agent/corpus.spec.ts`.
- `storage/chatFiles.spec.ts` (with `memoryFolder`).
- `claudeAgent.spec.ts`, `geminiAgent.spec.ts`: `resume`.
- `stores/project.spec.ts`, `stores/chat.spec.ts`, `stores/settings.spec.ts`.
- `ChatList.spec.ts`, `ProjectView.spec.ts` (tabs), `ChatPane.spec.ts`, `SettingsView.spec.ts`.
- `tests/e2e/chat-history.e2e.ts`; `a11y.e2e.ts` covers the Chats tab.

## Out of scope

- Deleting or renaming chats; searching them.
- A chat that updates while a colleague adds to it (opening it again shows the latest).
- An IndexedDB cache of chat files (they are small; every computer reads them once per page load).
- Exporting answers.

## Handoff

### 2026-10-27 — Phase 21 done (branch `phase-21-chat-history`, from `main_phase2`)

**Before the phase:** `main_phase2` had a failing Settings unit test, a failing settings e2e test and a Prettier warning,
all from the About text edit in 1ad83c9. Fixed first, in two `fix:` commits (tests and formatting only).

**As built:**
- The decision is **D29**: D27 and D28 were taken.
- `project.load()` reads the chats after the status is `ready`, so the sessions show first; `refresh()` rescans
  `chats/` after the sessions, on every focus. A save during a rescan makes the rescan skip publishing and run again,
  as for sessions. Chat files aren't cached in IndexedDB.
- `chat.persist()` builds the file at once and queues the write on the chat's own target object, so a save that ends
  after **New chat** still updates the right file. A colleague's chat, or a chat saved under an old identity (after
  **Clear saved data**), becomes a copy at its first save.
- A `changed` error (the same person on another computer wrote the file) saves the chat as a copy too.
- The model is frozen at the first question after a chat is opened, so a reopened chat may use another model or
  provider: the history is plain text.
- `SessionList` keeps its "Sessions N" heading for screen readers (the e2e specs find it); the tab shows it.
- `useRovingListbox` uses `data-item-id` (was `data-session-id` in `SessionList`).

**Resuming and the APIs** (details in `reference/llm-providers.md`, "Resuming a saved chat"):
- **Claude:** the skill's preserved-thinking guidance applies only to thinking blocks that are sent back. It says
  retained turns may have their thinking blocks stripped ("text and tool calls can stay"), and our history has none.
- **Gemini:** only the current turn's function calls need their thought signatures (Phase 20's reading of Google's
  page), so earlier model turns without them are accepted.
- Both are pending live checks H1 and H2.

**UI text (D13):**
- No help text on the Chats tab.
- The colleague line is "Anna’s chat. Asking saves a copy as yours."
- The save notice is "Describe couldn't save this chat to the project folder." with **Try again**.
- The Settings band is **Chats**, with **Your name** (the made-up name as its placeholder) and one hint line:
  "Colleagues see it on the chats you save in a project."
- The About text says "Chats are saved in the project folder, where everyone who can open it can read them."

**For Phase 18:**
- Add live checks H1–H3 to the release checks.
- Add a row to the OneDrive manual checklist: a colleague's chat appears after sync, and continuing it makes a copy.
- Phase 18 now also depends on this phase.

**Possible follow-ups:** delete your own chats (needs a `remove` on `ProjectFolder`), an IndexedDB cache of chat
files for large projects, and search across chats.

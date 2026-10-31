# Phase 1 — Domain model & ElevenLabs provider

**Goal:** Everything needed to turn a `File` plus options into a `TranscriptDoc`, without UI: domain helpers,
segmentation, file checks, the `TranscriptionProvider` contract, and a fully tested ElevenLabs implementation.
Also run the live checks V1–V6 and record the results.

**Depends on:** Phase 0.

**Read first:** [ROADMAP.md](../ROADMAP.md) §5–6, [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md),
[DECISIONS.md](../DECISIONS.md) D2, D4, D5, T2, T3, T5.

## Tasks

### Domain (pure)

1. **`src/domain/transcript.ts`:** add the helpers.
   - `formatTimestamp(sec: number): string`: always `HH:MM:SS`, floors fractional seconds, clamps negatives to 0.
   - `normalizeLanguage(code: string): string`: maps ISO-639-3/-1 to ISO-639-1 for at least `eng/en`, `deu/ger/de`,
     `fra/fre/fr`. Unknown codes are returned lower-cased and unchanged.
   - `languageName(code: string): string`: `'English' | 'German' | 'French'`, otherwise the code upper-cased.
   - `defaultSpeakerLabel(index: number): string`: `Speaker ${index + 1}`.
2. **`src/domain/segmentation.ts`:** `buildTurns(tokens, opts?)` implementing ROADMAP §6.
   - Join the token texts of a turn exactly (spacing tokens included), then `trim()`.
   - `start` is the first timed token's start; `end` is the last timed token's end.
   - Fill missing token times from the previous token's `end`, or the next token's `start` if there is no previous.
   - Leading spacing tokens never create a turn. A turn with only whitespace is dropped.
   - `opts`: `{ softMaxTurnSec = 90, hardMaxTurnSec = 120 }`.
   - `words` holds only `kind === 'word' | 'event'` tokens, with the times filled in.
3. **`src/domain/buildTranscriptDoc.ts`:** `buildTranscriptDoc(norm, source, request, deps = { now, uuid })`
   returns `TranscriptDoc` (`translations: {}`, speakers labelled by first appearance).
4. **`src/domain/filecheck.ts`:**
   `checkFile(info: { name; size; type; durationSec: number | null }, limits): FileCheck`. Errors: too large,
   too long, too short, empty file. Warnings: unknown duration, unusual extension (allow-list: `mp3 m4a wav aac
   flac ogg opus webm mp4 mov mkv wma aiff`).

### Provider contract

5. **`src/providers/errors.ts`:** `ProviderError`.
6. **`src/providers/transcription/types.ts`:** the contract below.

### ElevenLabs implementation (`src/providers/transcription/elevenlabs/`)

7. **`limits.ts`:** constants from the reference doc.
8. **`types.ts`:** zod schemas for the response (single-channel) and the error body. Export the inferred types.
9. **`request.ts`:** `buildFormData(input): FormData` and `buildUrl(zeroRetention): string`. Follow the field table in
   the reference doc. Omit `language_code` for `auto`, `num_speakers` for `null`, and `keyterms` when empty. Encode
   keyterms according to the outcome of **V1** (default: repeated fields).
10. **`transport.ts`:** `xhrTransport: Transport` (contract below). Uses `XMLHttpRequest`:
    - `upload.onprogress` → `onUploadProgress(loaded, total)`; `upload.onload` → `onUploadDone()`.
    - `timeout = 0` (no client timeout; transcription can take minutes).
    - `signal` abort → `xhr.abort()` → reject with `ProviderError('aborted')`.
    - `onerror` → reject with `ProviderError('network')`.
    - Resolves `{ status, bodyText }` for **any** HTTP status. Status mapping happens elsewhere.
11. **`errors.ts`:** `toProviderError(status, bodyText): ProviderError` following the reference table. Parse
    `detail` (string or `{status, message}`). Never include headers or the key.
12. **`mapper.ts`:** `toNormalized(json: unknown): NormalizedTranscription`.
    - Validate with zod and throw `ProviderError('bad_output')` on mismatch.
    - Reject the multichannel shape.
    - Map `type` to `kind`: `word` → `'word'`, `spacing` → `'spacing'`, `audio_event` → `'event'`.
13. **`provider.ts`:** `createElevenLabsProvider(transport = xhrTransport): TranscriptionProvider`.
    - `transcribe` sends the request, emits `{phase:'uploading'}` then `{phase:'processing'}`, maps errors, maps
      the response, and returns a `NormalizedTranscription`.
    - `verifyKey` implements the result of V3, or is omitted if V3 finds no suitable endpoint.

### Fixtures & live checks

14. **Fixtures** (`fixtures/elevenlabs/`), all synthetic text with no real personal data:
    - `two-speakers-short.json`: about 60 tokens, 2 speakers, German.
    - `three-speakers-en.json`: about 150 tokens, 3 speakers.
    - `long-monologue.json`: one speaker, about 300 s of words, with sentence ends placed so the 90 s/120 s split
      rules are exercised. Generate it with a small script if easier.
    - `null-speakers.json`: `speaker_id: null` throughout, plus some tokens with null times.
    - `error-401.json`, `error-422.json`, `error-429.json`.
15. **`scripts/live-check-elevenlabs.mjs`** (Node ≥ 20, uses global `fetch`/`FormData`/`Blob`; reads
    `ELEVENLABS_API_KEY` and a file path from argv). It runs V1–V3 and V5 and prints the results. The user runs V4
    with a long file of their own. Write all results into the verification log in
    [reference/elevenlabs-stt.md](../reference/elevenlabs-stt.md). If no key is available, leave the items
    *pending* and use the defaults.

## Contracts introduced

```ts
// src/providers/errors.ts
export type ProviderErrorKind =
  | 'auth' | 'quota' | 'validation' | 'rate_limit' | 'server' | 'network'
  | 'aborted' | 'refused' | 'bad_output' | 'unknown';
export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly userMessage: string,     // safe to show; never contains secrets
    public readonly opts: { status?: number; retryable?: boolean; detail?: string } = {},
  ) { super(userMessage); this.name = 'ProviderError'; }
  get retryable(): boolean { return this.opts.retryable ?? ['rate_limit', 'server', 'network'].includes(this.kind); }
}

// src/providers/transcription/types.ts
import type { LanguageHint } from '../../domain/transcript';
export interface NormalizedToken {
  text: string;
  start: number | null;
  end: number | null;
  speakerId: string | null;
  kind: 'word' | 'spacing' | 'event';
  logprob: number | null;
}
export interface NormalizedTranscription {
  providerTranscriptId: string | null;
  languageCode: string;
  languageProbability: number | null;
  audioDurationSec: number | null;
  tokens: NormalizedToken[];
}
export interface TranscriptionInput {
  file: File;
  apiKey: string;
  languageHint: LanguageHint;
  numSpeakers: number | null;
  zeroRetention: boolean;
  keyterms: string[];
}
export type TranscriptionProgress =
  | { phase: 'uploading'; loaded: number; total: number }
  | { phase: 'processing' };
export interface KeyCheckResult { ok: boolean; message: string }
export interface TranscriptionProvider {
  readonly id: 'elevenlabs';
  readonly model: string;
  readonly limits: { maxFileBytes: number; maxDurationSec: number; minDurationSec: number; maxSpeakers: number;
                     keyterms: { maxTerms: number; maxChars: number; maxWords: number } };
  transcribe(input: TranscriptionInput,
             opts: { signal: AbortSignal; onProgress: (p: TranscriptionProgress) => void }): Promise<NormalizedTranscription>;
  verifyKey?(apiKey: string, signal?: AbortSignal): Promise<KeyCheckResult>;
}

// src/providers/transcription/elevenlabs/transport.ts
export interface Transport {
  post(url: string, body: FormData, headers: Record<string, string>, opts: {
    signal: AbortSignal;
    onUploadProgress?: (loaded: number, total: number) => void;
    onUploadDone?: () => void;
  }): Promise<{ status: number; bodyText: string }>;
  get(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; bodyText: string }>;
}

// src/domain/segmentation.ts
export function buildTurns(tokens: NormalizedToken[], opts?: { softMaxTurnSec?: number; hardMaxTurnSec?: number }):
  { speakers: Speaker[]; turns: Turn[] };

// src/domain/buildTranscriptDoc.ts
export function buildTranscriptDoc(norm: NormalizedTranscription, source: SourceInfo, request: TranscriptionRequestInfo,
  deps?: { now?: () => Date; uuid?: () => string }): TranscriptDoc;

// src/domain/filecheck.ts
export interface FileCheck { ok: boolean; errors: string[]; warnings: string[] }
export function checkFile(info: { name: string; size: number; type: string; durationSec: number | null },
  limits: { maxFileBytes: number; maxDurationSec: number; minDurationSec: number }): FileCheck;
```

> `NormalizedToken` is a type the domain consumes. Define it in `src/domain/transcript.ts` (or a
> `src/domain/tokens.ts`) and re-export it from the provider types, so that `domain/` never imports from
> `providers/`.

## Acceptance criteria

- [x] Given each fixture, `buildTranscriptDoc(toNormalized(fixture), …)` produces the expected speakers, turn
      count, turn boundaries, texts and timestamps (asserted in tests).
- [x] `buildFormData` produces exactly the documented fields for each combination of options (auto vs set
      language, speakers null vs number, glossary empty vs filled, zero retention on/off → URL).
- [x] Every row of the error table maps to the right `ProviderError.kind` and `userMessage`. No message contains
      the API key (test this with a sentinel key).
- [x] `transcribe()` with a fake transport emits progress in order (`uploading` → `processing`), resolves on 200,
      rejects with `aborted` when the signal aborts, and rejects with the mapped error otherwise.
- [x] The verification log has results for V1–V3 and V5 (or is explicitly marked *pending — no key available*).
- [x] Domain modules import nothing from `vue`, `pinia`, `providers/` or `storage/`. Add an ESLint
      `no-restricted-imports` rule for `src/domain/**` to enforce this.

## Required tests

- `domain/transcript.spec.ts`: `formatTimestamp` (0, 59.9, 3600, 36000+), `normalizeLanguage`, `languageName`.
- `domain/segmentation.spec.ts`: speaker changes, spacing at boundaries, the 90 s/120 s splits, null speakers,
  null times, empty input, events.
- `domain/filecheck.spec.ts`: each error and warning.
- `elevenlabs/request.spec.ts`, `errors.spec.ts`, `mapper.spec.ts`, `provider.spec.ts` (fake transport).

## Out of scope

UI, stores (except types they need), the job state machine (Phase 4), async/webhook polling (only design it, in
the reference doc, if V4 shows it is needed).

## Handoff

*(Record V1–V6 outcomes here too, in one line each, with any changes to defaults.)*

### 2026-10-13 — Phase 1 done (branch `phase-1-domain-elevenlabs`, based on `phase-0-scaffold`)

**Verification log** (no key was available, and CLAUDE.md forbids live calls unless the user asks):
- **V1:** pending. Keyterms are sent as repeated `keyterms` fields (the default).
- **V2:** pending. A rejection would surface through the normal error mapping.
- **V3:** pending. `verifyKey` is **not implemented**, so Phase 2 must hide "Test key" for ElevenLabs until V3 is
  answered.
- **V4:** pending; needs a long recording of the maintainer's own. The request is synchronous with
  `xhr.timeout = 0`.
- **V5:** pending. We send ISO-639-1. `normalizeLanguage()` accepts ISO-639-1 and -3 codes, with or without a
  region.
- **V6:** pending (Phase 7).

**Running the checks:** `scripts/live-check-elevenlabs.mjs` covers V1–V3 and V5. It was exercised offline with a
stubbed `fetch` (correct requests, key never printed). Instructions are in `docs/reference/elevenlabs-stt.md`.

**What's new**
- **T8 — zod via `src/lib/zod.ts`.** zod 4 checks for eval support when an object schema is constructed, which would
  trigger a CSP violation. `src/lib/zod.ts` turns on jitless mode and re-exports `z`. ESLint blocks direct `zod`
  imports, so later phases (`storage/idb.ts`, translation schemas) must use `lib/zod`.
- **Tokens:** `NormalizedToken` and `NormalizedTranscription` live in `src/domain/tokens.ts`.
  `providers/transcription/types.ts` re-exports them.
- **Helpers for Phase 2:** `formatBytes()` is exported from `src/domain/filecheck.ts`, so `FileDrop` should reuse it.
  `checkFile` also skips the extension warning when the browser reports an `audio/*` or `video/*` MIME type.
- **Redaction helpers:** `src/providers/errors.ts` also exports `redactSecret()` and `withoutSecret()`. The LLM
  adapters in Phase 6 should use them the same way.
- **Job store type:** `job.error` is now `ShallowRef<ProviderError | null>`. This is a type change only; the store
  is still the Phase 0 stub.
- **Fixtures:** the fixtures come from `scripts/make-elevenlabs-fixtures.mjs` (deterministic). Edit the script and
  re-run it rather than editing the JSON by hand. Prettier ignores these files.
- **Lint scope:** the domain layering rule now skips `src/domain/**/*.spec.ts`, so a domain test can feed provider
  output (fixtures through `toNormalized`) into `buildTranscriptDoc`.

**Segmentation choices** (the details the ROADMAP rules didn't pin down):
- Spacing tokens are held back and join a turn only when the next word stays in it, so turns never start or end with
  spacing.
- `turn.end` is the last word's end, not the end of trailing silence.
- A word or event with a null speaker becomes `speaker_0`, even in the middle of a diarized turn. This is unlikely
  with `diarize=true`.
- If a token's start is missing and there is no previous token, it takes the next token's start, or that token's
  end when its start is missing too.
- The soft and hard limits use strict "greater than" (`>` 90 s / `> 120 s`).

**Error mapping additions** (also in the reference doc):
- 403 maps to `auth`.
- 400 and 413 map to `validation`.
- Quota is detected from the body on any 4xx except 429.
- Other statuses map to `unknown`, with the status in the message.
- Non-JSON bodies never reach the user.

**Tests:** there are 171 unit tests. I spot-checked them by mutation: 8 deliberate bugs, and each made at least one
test fail. The bugs covered the soft split, the spacing join, time filling, key redaction, body quota detection, the
keyterm encoding, the transport's listener cleanup, and timestamp rounding.

**Bundle:** unchanged at 76 KB. Nothing in the app imports the provider yet; Phase 4 wires it up.

### 2026-10-13 — Live checks run by the maintainer (follow-up commit on the same branch)

Results are in the verification log of `docs/reference/elevenlabs-stt.md`. Each one and what changed:
- **V1 — confirmed: repeated `keyterms` fields.** A JSON-array string fails with 400 `invalid_keyword`. The API
  reference lists the unsupported characters as `< > { } [ ] \`, and says terms must be *under* 50 characters.
  - `ELEVENLABS_LIMITS.keyterms` now has `maxChars: 49` and `forbiddenChars`, and the
    `TranscriptionProvider.limits` type includes it.
  - Phase 3's `validateTerm` contract has a new `unsupported_chars` issue, and its acceptance criteria are updated.
  - **One bad term fails the whole request**, so Phase 3 must filter invalid terms out of `validTerms`.
  - `invalid_keyword` now maps to a message that names the characters.
- **V2 — non-Enterprise keys get 403 `not_allowed`** ("…enterprise or trial tier can use ZRM mode"). This used to
  map to "ElevenLabs rejected the API key", which was wrong. It is now a `validation` error telling the user to
  untick Zero retention. The Phase 2 help text is updated.
- **V3 — no GET endpoint works with a restricted key.** `/v1/user`, `/v1/user/subscription` and `/v1/models` all
  return 401 `missing_permissions`. `missing_permissions` now maps to its own message: the key lacks Speech-to-Text
  access. The script gained a free probe, `POST /v1/speech-to-text` without a file, with the real key and with an
  invalid one. If that tells the two keys apart, `verifyKey` can use it.
- **V5 — the response uses ISO-639-3** (`"eng"`), and both `de` and `deu` are accepted in requests. No code change.
- **Other 403s** now quote ElevenLabs' own message instead of blaming the key.
- **Request IDs** from error bodies are kept in `ProviderError.opts.detail`, for support.
- **New fixtures** (from the real response shapes, with fake request ids): `error-400-invalid-keyword`,
  `error-403-zero-retention` and `error-401-missing-permissions`.

### 2026-10-13 — V3 answered: `verifyKey` implemented

The free probe worked. With no file, the maintainer's key got 400 `invalid_parameters` ("Must provide either
file or a URL parameter.") and an invalid key got 401 `invalid_api_key`.

`createElevenLabsProvider().verifyKey(key, signal?)` sends that no-audio request and returns `{ ok, message }`:

| Answer | Result |
|---|---|
| 400/422 about the missing file | ok |
| 401 | "doesn't recognise this key" |
| `missing_permissions` | the permission message |
| anything else | the normal error message (network, busy, …), redacted |

It also handles these cases:
- **Empty key:** it returns "Enter a key first." and makes no request.
- **Abort:** it rejects only when the signal aborts.

**New fixture:** `error-400-missing-file`. `error-401` now has the full shape seen live.

**Phase 2** can show "Test key" for ElevenLabs. Its task text is updated.

**Not observed:** a key that lacks Speech-to-Text permission entirely. The expected 401 `missing_permissions` is
handled, but unconfirmed.

# ElevenLabs Speech-to-Text — reference for DeScribe

*Facts gathered 2026-10-13 from the official docs and a live CORS preflight. Items marked **VERIFY** must be
confirmed with a real key in Phase 1 (see the [verification log](#verification-log) at the bottom).*

Official docs: <https://elevenlabs.io/docs/api-reference/speech-to-text/convert> ·
<https://elevenlabs.io/docs/overview/capabilities/speech-to-text>

## Endpoint

```
POST https://api.elevenlabs.io/v1/speech-to-text            (normal)
POST https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false   (zero retention, Enterprise only; V2: 403 otherwise)
Header: xi-api-key: <key>
Body:   multipart/form-data   (do NOT set Content-Type yourself; the browser adds the boundary)
```

### CORS (verified 2026-10-13)

A preflight with `Origin: null` (what a page opened from `file://` sends) returns:

```
access-control-allow-origin: *
access-control-allow-headers: *
access-control-allow-methods: POST, PATCH, OPTIONS, DELETE, GET, PUT
```

So the browser can call the API directly from the single HTML file.

## Request fields DeScribe sends

| Field | Value in DeScribe | Notes |
|---|---|---|
| `model_id` | `scribe_v2` | Required |
| `file` | the selected `File` | Under 3 GB (product docs; the API reference says 5 GB, so we use the stricter 3 GB). Minimum 100 ms. Audio or video. |
| `language_code` | ElevenLabs' ISO 639-3 code for the chosen language (`deu`, `spa`, …), or **omitted** for Auto | ISO-639-1 or ISO-639-3 accepted (both confirmed for German, V5). The list: [Supported languages](#supported-languages). |
| `diarize` | `true` | Speaker separation |
| `num_speakers` | 1–32, or **omitted** for Auto | Max 32 |
| `timestamps_granularity` | `word` | |
| `tag_audio_events` | `false` | D4 |
| `no_verbatim` | `true` | Removes filler words and false starts (scribe_v2 only). D4. |
| `keyterms` | one entry per glossary term, **omitted** if the glossary is empty | Repeated multipart fields (`keyterms=A`, `keyterms=B`, …), confirmed in V1. A single JSON-array string is treated as one term and rejected because of its `[`, `]` characters. |

Parameters we deliberately **don't** use: `source_url`, `cloud_storage_url`, `use_multi_channel`,
`detect_speaker_roles`, `entity_detection`/`entity_redaction`, `transcript_edit`, `additional_formats`,
`temperature`, `seed`, `diarization_threshold`, `webhook` (except as a possible fallback, see V4).

## Supported languages

From the [Speech-to-Text page](https://elevenlabs.io/docs/overview/capabilities/speech-to-text), 2026-11-01. It says
Scribe v2 supports "90+ languages" and groups them by word error rate (WER). Setup lists only the first tier (D37);
every other language is transcribed with Auto-detect.

| Tier | Languages (ISO 639-3) |
|---|---|
| **Excellent** (≤ 5% WER), listed on Setup | Belarusian (bel), Bosnian (bos), Bulgarian (bul), Catalan (cat), Croatian (hrv), Czech (ces), Danish (dan), Dutch (nld), English (eng), Estonian (est), Finnish (fin), French (fra), Galician (glg), German (deu), Greek (ell), Hungarian (hun), Icelandic (isl), Indonesian (ind), Italian (ita), Japanese (jpn), Kannada (kan), Latvian (lav), Macedonian (mkd), Malay (msa), Malayalam (mal), Norwegian (nor), Polish (pol), Portuguese (por), Romanian (ron), Russian (rus), Slovak (slk), Spanish (spa), Swedish (swe), Turkish (tur), Ukrainian (ukr), Vietnamese (vie) |
| High accuracy (> 5% to ≤ 10%) | Armenian (hye), Azerbaijani (aze), Bengali (ben), Cantonese (yue), Filipino (fil), Georgian (kat), Gujarati (guj), Hindi (hin), Kazakh (kaz), Lithuanian (lit), Maltese (mlt), Mandarin (cmn), Marathi (mar), Nepali (nep), Odia (ori), Persian (fas), Serbian (srp), Slovenian (slv), Swahili (swa), Tamil (tam), Telugu (tel) |
| Good (> 10% to ≤ 20%) | Afrikaans (afr), Arabic (ara), Assamese (asm), Asturian (ast), Burmese (mya), Hausa (hau), Hebrew (heb), Javanese (jav), Korean (kor), Kyrgyz (kir), Luxembourgish (ltz), Māori (mri), Occitan (oci), Punjabi (pan), Tajik (tgk), Thai (tha), Uzbek (uzb), Welsh (cym) |
| Moderate (> 25% to ≤ 50%) | Amharic (amh), Ganda (lug), Igbo (ibo), Irish (gle), Khmer (khm), Kurdish (kur), Lao (lao), Mongolian (mon), Northern Sotho (nso), Pashto (pus), Shona (sna), Sindhi (snd), Sinhala (sin), Somali (som), Urdu (urd), Wolof (wol), Xhosa (xho), Yoruba (yor), Zulu (zul) |

The page isn't consistent: its main list also has Chichewa (nya), Cebuano (ceb), Fulah (ful), Kabuverdianu (kea), Luo
(luo) and Umbundu (umb), which are in no tier; it calls Mandarin `zho` in one place and `cmn` in another; and no tier
covers 20–25%. DeScribe names any code the response returns with `Intl.DisplayNames` (`languageName()`), so these
gaps don't matter outside the Setup list.

## Limits & cost

| Item | Limit |
|---|---|
| File size | 3 GB (DeScribe limit) |
| Duration | 10 h |
| Minimum duration | 100 ms |
| Speakers | up to 32 |
| `keyterms` | up to 1000 terms; each **under 50 characters** (so ≤ 49), at most 5 words, and without any of `< > { } [ ] \` (API reference, 2026-10-13). One bad term fails the **whole** request with 400 `invalid_keyword` (V1). |
| Cost | billed per hour of audio; **keyterms add 20%**; with more than 100 keyterms a 20 s minimum is billed |
| Concurrency | files longer than 8 min use `min(4, ceil(duration_s / 480))` concurrency slots, so expect HTTP 429 when the account's concurrency is exhausted |

Put these constants in `src/providers/transcription/elevenlabs/limits.ts`:

```ts
export const ELEVENLABS_LIMITS = {
  maxFileBytes: 3 * 1024 ** 3,
  maxDurationSec: 10 * 3600,
  minDurationSec: 0.1,
  maxSpeakers: 32,
  keyterms: { maxTerms: 1000, maxChars: 49, maxWords: 5, forbiddenChars: '<>{}[]\\' },
} as const;
export const ELEVENLABS_MODEL = 'scribe_v2';
```

**How DeScribe counts keyterm limits** (Phase 3, `domain/glossary.ts`). The API reference doesn't say how it counts,
so these are assumptions, **not live-checked**:
- **Characters** are Unicode code points of the NFC-normalised term, so `Hörgerät` is 8, even if it was pasted in
  decomposed form.
- **Words** are separated by whitespace, so `behind-the-ear` is one word.

If ElevenLabs counts differently (for example UTF-16 units, or hyphens as word breaks), a term near a limit could
still fail a run with 400 `invalid_keyword`. A live check would send a 49-character term containing an emoji and a
5-word term with hyphens.

## Response (single channel)

```jsonc
{
  "language_code": "deu",            // ISO-639-3 (confirmed: an English clip returned "eng", V5)
  "language_probability": 0.98,
  "text": "Guten Tag. Hallo, schön Sie zu sehen.",
  "words": [
    { "text": "Guten",  "start": 0.12, "end": 0.40, "type": "word",    "speaker_id": "speaker_0", "logprob": -0.02 },
    { "text": " ",      "start": 0.40, "end": 0.45, "type": "spacing", "speaker_id": "speaker_0", "logprob": 0 },
    { "text": "Tag.",   "start": 0.45, "end": 0.80, "type": "word",    "speaker_id": "speaker_0", "logprob": -0.01 },
    { "text": " ",      "start": 0.80, "end": 1.30, "type": "spacing", "speaker_id": "speaker_0", "logprob": 0 },
    { "text": "Hallo,", "start": 1.30, "end": 1.62, "type": "word",    "speaker_id": "speaker_1", "logprob": -0.05 }
    // …
  ],
  "transcription_id": "…",           // nullable
  "audio_duration_secs": 3.1          // nullable
}
```

Field notes:
- `language_code` is nullable in the schema, though no response has left it out so far. Without it, the transcript
  takes the language chosen on Setup. With Auto it has none: the screen and the Word file leave it out, and the
  prompts call it "Unknown language" ([llm-providers.md](llm-providers.md), session summaries).
- `words[].type`: `word` | `spacing` | `audio_event`. We never request audio events, but the mapper should accept
  them.
- `start`, `end` and `speaker_id` are nullable.
- `characters` (character-level timing) appears only with `timestamps_granularity=character`, which we don't use.
- A different, **multichannel** shape (`{ transcripts: [...] }`) exists. We never request it, so the mapper rejects it
  with an error.

Validate the response at runtime with zod in `elevenlabs/types.ts` and fail clearly if the shape is unexpected.

## Errors

| HTTP | Meaning | `ProviderError.kind` | Message to user (draft) |
|---|---|---|---|
| 0 / network error | offline, proxy block, CORS failure | `network` | "Couldn't reach ElevenLabs. Check your internet connection or whether your network blocks api.elevenlabs.io." |
| 401 | invalid or missing key | `auth` | "ElevenLabs rejected the API key. Check the key in Settings." |
| 401/403 `missing_permissions` | key isn't allowed to use this endpoint (seen in V3) | `auth` | "This ElevenLabs API key isn't allowed to use Speech-to-Text. In the ElevenLabs dashboard, give the key Speech-to-Text access, or use another key." |
| 403 `not_allowed` + "ZRM" | zero retention on a non-Enterprise plan (seen in V2) | `validation` | "Zero retention is only available on ElevenLabs Enterprise plans. Switch off "Zero retention" on the Setup tab and try again." |
| 403 (other) | forbidden for another reason | `auth` | "ElevenLabs refused the request: <message>." |
| 402 / quota error in body | out of credits | `quota` | "Your ElevenLabs account has no remaining credits for this file." |
| 400 `invalid_keyword` | a glossary term has unsupported characters (seen in V1) | `validation` | "A glossary term contains characters ElevenLabs doesn't accept (`< > { } [ ] \`). Remove them from the glossary and try again." |
| 400 / 413 / 422 | validation error (`detail` explains) | `validation` | "ElevenLabs couldn't process the request: <detail>." |
| 429 | rate or concurrency limit | `rate_limit` (retryable) | "ElevenLabs is busy or your plan's limit was reached. Try again in a minute." |
| 5xx | server error | `server` (retryable) | "ElevenLabs had a problem. Try again." |

Error bodies seen live (2026-10-13) look like
`{"detail": {"type": "validation_error", "code": "invalid_parameters", "status": "invalid_keyword", "message": "…", "request_id": "…", "param": "keywords"}}`.
`status` is the specific reason and `code` the general one. Older or simpler shapes are `{"detail": {"status", "message"}}`,
`{"detail": "<text>"}` and FastAPI lists (`{"detail": [{"loc", "msg"}]}`); all are handled. The `request_id` goes into
`ProviderError.opts.detail` (useful when contacting ElevenLabs support), never into the user message.
Status codes seen so far: `invalid_keyword`, `not_allowed`, `missing_permissions`.

## Other endpoints

- `GET /v1/speech-to-text/transcripts/{transcription_id}` returns a stored transcript, and can be used to poll
  for an asynchronous result (fallback for V4).
- **"Test key" (V3):** `GET /v1/user`, `GET /v1/user/subscription` and `GET /v1/models` all return 401
  `missing_permissions` for a key restricted to Speech-to-Text, so none of them can verify such a key. Instead,
  `verifyKey` sends `POST /v1/speech-to-text` with only `model_id` and **no file**:

  | Answer | Meaning |
  |---|---|
  | 400 `invalid_parameters` ("Must provide either file or a URL parameter.") | The key is valid |
  | 401 `invalid_api_key` | The key is wrong |
  | 401/403 `missing_permissions` | The key can't use Speech-to-Text |
  | Anything else | Explained with the normal error mapping |

  No audio is sent, so nothing is transcribed or billed.

## Verification log

The Phase 1 agent fills this in using `scripts/live-check-elevenlabs.mjs` with `ELEVENLABS_API_KEY` from the
environment. Never commit keys or private audio.

**How to run it** (costs up to 5 transcriptions of a short clip; V3 sends no audio and is free). In PowerShell:

```powershell
$env:ELEVENLABS_API_KEY = "<key>"
node scripts/live-check-elevenlabs.mjs <10–30 s speech clip> --terms "Oticon,Hörgerät"
```

`--only V3` runs just the free key checks. The script prints table rows to paste below and never prints the key.
Choose `--terms` that are actually spoken in the clip, or V1 can't show whether they were picked up.

| ID | Question | Result | Date |
|---|---|---|---|
| V1 | How must `keyterms` be encoded in multipart: repeated fields or a JSON array string? Does the response reflect the terms? | **Repeated fields.** Repeated fields → 200. A JSON-array string → 400 `invalid_keyword` ("Some keyword contains invalid characters"): the string is taken as one term and `[`, `]` aren't allowed. The API reference lists the unsupported characters as `< > { } [ ] \`, and one bad term fails the whole request. Whether the terms change the output wasn't measured: the clip (English) didn't contain them. | 2026-10-13 |
| V2 | With `enable_logging=false` on a **non-Enterprise** key: is the request rejected (which status/message?) or silently accepted? | **Rejected:** 403, `code: forbidden`, `status: not_allowed`, "Only users from the enterprise or trial tier can use ZRM mode." Mapped to a `validation` error that tells the user to switch off Zero retention; before this check it would have blamed the API key. | 2026-10-13 |
| V3 | Which endpoint can verify a key scoped only to speech-to-text? | **`POST /v1/speech-to-text` without a file.** The GET candidates don't work: with the maintainer's restricted key, `GET /v1/user`, `/v1/user/subscription` and `/v1/models` all → 401 `missing_permissions`. The no-audio POST tells keys apart, so ElevenLabs checks the key before the body: the real key → 400 `invalid_parameters` "Must provide either file or a URL parameter."; an invalid key → 401 `invalid_api_key`. Nothing is transcribed, so it's free. `verifyKey` uses it. Not observed: a key *without* Speech-to-Text permission (expected 401 `missing_permissions`, which has its own message). | 2026-10-13 |
| V4 | Does a synchronous request for a ≥ 60 min file complete reliably (Node and browser)? Record processing time ÷ audio length. If not, design async: `webhook=true` → 202 + `transcription_id` → poll `GET …/transcripts/{id}`. Check whether `webhook=true` needs a webhook configured in the ElevenLabs dashboard. | **Accepted for 1.0 as a known limitation** until [TESTING.md](../TESTING.md) scenario 5 is run on the release file. It needs a long recording of the maintainer's own; the result goes here. Default: a synchronous request with no client timeout (`xhr.timeout = 0`). The Output tab shows the processing time. If a long run fails, design the async fallback described in the question. | 2026-10-14 (accepted) |
| V5 | What format is `language_code` in the response (`deu` vs `de`)? Is `language_code=de` accepted in the request? | **Response: ISO-639-3** (an English clip with Auto returned `"eng"`). **Request: both** `de` and `deu` → 200. No change: we send ISO-639-1, and `normalizeLanguage()` maps `eng`/`deu`/`fra`. | 2026-10-13 |
| V7 | Does `language_code` take ElevenLabs' ISO 639-3 code for the newly listed languages (spot check `spa`, `jpn`, `nor`, `msa`), and does the response return the same language? | *Pending* (Phase 26; no real API calls until the maintainer asks). Assumption until then: yes, as V5 showed for `deu`, since the codes are the ones the docs list. | – |
| V6 | Which formats do ElevenLabs and Chromium `<audio>` both handle (mp3, m4a, wav, mp4, webm, ogg, flac)? Note any that ElevenLabs accepts but the browser can't play. | **Browser side measured; see [V6 details](#v6-details-what-the-browser-can-play).** Every common format plays, including the audio track of mp4, mov, mkv and webm video. Not playable: wma, wmv, avi and aiff (media error 4: the app shows the format message). Two silent traps in Chrome (Edge is fine): AC-3 audio in mp4 plays the video with **no sound and no error**, and HEVC video makes `play()` reject with `NotSupportedError` (now shown as the format message). ElevenLabs acceptance of each format wasn't re-tested (no live call). | 2026-10-13 |

### V6 details: what the browser can play

Measured on 2026-10-13 with 3-second samples made by ffmpeg from `fixtures/audio/tone-12s.wav` (video ones with a
grey picture). Each was loaded into an `<audio>` element through a blob URL, as the app does, played, and checked
for a real signal with a Web Audio analyser. Browsers: Edge 155.0.4283.45, Chrome 155.0.8059.40, and Playwright's
Chromium 156.0.8078.4 (which also plays H.264/AAC, so the e2e tests could use mp4 if they ever need to).

| Sample | Edge | Chrome | Playwright Chromium |
|---|---|---|---|
| wav, mp3, m4a (AAC), aac (ADTS), flac, ogg (Vorbis), opus, webm (Opus) | sound | sound | sound |
| mp4 / mov / mkv (H.264 + AAC), mov (H.264 + PCM), webm (VP9 + Opus) | sound | sound | sound |
| mp4 (H.264 + **AC-3**) | sound | **silent, no error** | silent, no error |
| mp4 (**HEVC** + AAC) | sound | `play()` rejects `NotSupportedError` | sound |
| wma, wmv (WMV2 + WMA), avi (MPEG-4 + MP3), aiff | media error 4 | media error 4 | media error 4 |

- **Handled:** error 4 and a `NotSupportedError` from `play()` both show *"This file format can't be played in the
  browser. The transcript is not affected."* with **Choose another file…**. HEVC support in Chrome depends on the
  machine's hardware decoder, so it may play elsewhere.
- **Not handled: AC-3 in Chrome.** Nothing signals the problem. **Accepted as a known limitation for 1.0**
  (2026-10-14): the User Guide's troubleshooting says to use Edge or convert to MP3. Detecting it (Chromium's
  `webkitAudioDecodedByteCount` staying at 0 while `currentTime` advances) is listed in `phases/future.md` (F4).
- The file picker accepts `audio/*,video/*,.m4a,.wma,.mkv,.opus`, so wma/wmv/avi recordings can be transcribed but
  not played back; converting to mp3/m4a/mp4 fixes playback.

### Implementation notes (Phase 1)

These go beyond the table above and come from the implementation in `src/providers/transcription/elevenlabs/`:
- **Error status mapping** (full table in [Errors](#errors)):
  - The specific codes seen live are checked first: `missing_permissions`, `invalid_keyword`, and 403
    `not_allowed` for zero retention.
  - Any other 403 maps to `auth` and quotes ElevenLabs' own message instead of blaming the key.
  - 400 and 413 map to `validation`, like 422.
  - Any other status maps to `unknown`, and the message names the status.
- **Quota errors are detected from the body as well as from 402.** ElevenLabs reports exhausted credits on other
  statuses too (e.g. 401 with `detail.status = "quota_exceeded"`). Any 4xx except 429 whose code or message mentions
  quota or credits maps to `quota`.
- **Proxy pages never reach the user.** Non-JSON error bodies (e.g. an HTML page from a proxy) are never copied into
  messages.
- **Unknown word types** (anything except `spacing` and `audio_event`) are treated as words. A new type therefore
  can't break every transcription.
- **The API key is never shown.** It is trimmed and sent only in the `xi-api-key` header. Every error message and
  detail is scrubbed of it before leaving the provider.

# Phase 33: what the maintainer does

Part A built and ran everything that needed no one at the PC ([reference/local-stt.md](../reference/local-stt.md)).
What's left needs you: the reference transcript, the power schemes, the timed runs, the test app, interrupting
downloads, the work laptop, and reading transcripts. Do the tasks in order. Part B then writes the go/no-go from what
you send back.

**Before you start**
- Open PowerShell 7 in the repository folder, on the branch `phase-33-local-stt-spike`. Every command below starts
  from there.
- Plug the PC in. During tasks 3–5, close other programs and leave the PC alone.
- Commands are on one line each: paste them one at a time.

## 1. The ElevenLabs reference (about 15 minutes)

This gives the local transcripts something to be measured against (word error rate, word times, speakers).

1. In DeScribe, transcribe `tests\audio\test_audio.m4a` with ElevenLabs (English, 2 speakers).
2. **Add to project**, into a new project folder outside the repository, e.g. `Documents\Phase 33 reference`.
3. Then compare every local run with it:

   ```powershell
   node scripts/spikes/local-stt/compare-all.mjs "<the project folder>\sessions\<the file>.transcript.json"
   ```

If you have real recordings of about 1 hour and about 3 hours (English, two speakers), say so: they can replace the
joined copies of the test file in task 4.

**Send back:** nothing yet: task 10 collects it.

## 2. The two power schemes (2 minutes)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\setup-emulation.ps1
```

- **What it does:** adds two copies of Balanced, "DeScribe laptop emulation" and "DeScribe laptop emulation
  (throttled)", each with a maximum processor frequency. It doesn't switch to them and doesn't change Balanced.
- If it says access is denied, run the same line in PowerShell as administrator.
- **To undo everything later:** the same line with `-Remove`.

## 3. Calibrate (about an hour per profile; leave the PC alone)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\calibrate.ps1 -Profile Laptop
```
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\calibrate.ps1 -Profile Throttled
```

- **What it does:** switches to the profile's scheme, then runs Cinebench 2024 and R23 pinned to the twelve processors
  that stand in for the laptop, changing the cap until neither score is more than 5 % above the laptop's (Laptop: 557
  and 10,036; Throttled: 60 % of those).
- **Why not both within 5 %:** the two benchmarks disagree about this PC (part A measured 1.37× the laptop in 2024 and
  1.62× in R23), so no single cap fits both. The script errs on the slow side: R23 ends near the laptop's score and
  2024 below it.
- Cinebench runs in the background; each round takes about 12 minutes.
- It switches back to your scheme when it ends, even after an error or Ctrl+C.
- The last line says the cap it found and how far each score is from the laptop's.

## 4. The timed runs (about 2 hours; leave the PC alone)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\run-benchmarks.ps1
```

- **What it does:** a quick Cinebench check, then the 5-minute, 1-hour and 3-hour files in the *Laptop* profile, at
  6, 8 and 12 threads, and once with two of the twelve processors kept busy; then the 1-hour file in *Throttled*.
  It switches back to your scheme at the end.
- With real recordings from task 1, add `-Recording1h "<path>" -Recording3h "<path>"`.

## 5. Load time from cold (5 minutes)

Restart the PC. Before opening anything else:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\run-benchmarks.ps1 -ColdLoad
```

## 6. The test app: where downloaded models would live (10 minutes)

A test package, **DeScribe STT probe** (`DeScribe.SttProbe`), installed beside DeScribe and removed again. It
writes 1 GB test files into its own package folders.

1. Trust the development certificate, **as administrator** (once; it's the same one `npm run desktop:pack -- --sign`
   uses):

   ```powershell
   winapp cert install devcert.pfx
   ```
2. Install version 1:

   ```powershell
   Add-AppxPackage scripts\spikes\local-stt\out\ipc-probe\DeScribe.SttProbe-1.0.0.0.msix
   ```
3. In a **new** PowerShell window (so it finds the app's command), in the repository folder:

   ```powershell
   describe-stt-probe --d7 --write --report "$PWD\scripts\spikes\local-stt\out\d7-v1.json"
   ```
4. Optional: open **DeScribe STT probe** from Start, drop a recording onto its window and click **Open dialog**, then
   **Copy results** and paste them into `scripts\spikes\local-stt\out\task5-paths.txt`.
5. Update to version 2, check again, uninstall, and check what's left:

   ```powershell
   Add-AppxPackage scripts\spikes\local-stt\out\ipc-probe\DeScribe.SttProbe-2.0.0.0.msix
   ```
   ```powershell
   describe-stt-probe --d7 --report "$PWD\scripts\spikes\local-stt\out\d7-v2.json"
   ```
   ```powershell
   Get-AppxPackage DeScribe.SttProbe | Remove-AppxPackage
   ```
   ```powershell
   Test-Path "$env:LOCALAPPDATA\Packages\DeScribe.SttProbe_*"
   ```

   The last line should print `False`.

## 7. Interrupted downloads (15 minutes; stay at the PC)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\interrupt-download.ps1
```

It downloads one model file three times and asks you, each time, to interrupt it: first by turning the network off
(then on again), then by putting the PC to sleep, then by closing the download's window. Follow its prompts.

## 8. On the work laptop (10 minutes)

Nothing is installed: only Windows' own `curl.exe`. In a PowerShell window, paste each line. Each line downloads
from Hugging Face, once in full (714 MB and 107 MB) and once a single megabyte.

```powershell
curl.exe -sS -L -o NUL -w "parakeet: status %{http_code}  redirects %{num_redirects}  bytes %{size_download}  seconds %{time_total}  bytes/s %{speed_download}  final host %{urle.host}`n" "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/parakeet-tdt-0.6b-v3.q8_0.gguf"
```
```powershell
curl.exe -sS -L -o NUL -w "diarization: status %{http_code}  redirects %{num_redirects}  bytes %{size_download}  seconds %{time_total}  bytes/s %{speed_download}  final host %{urle.host}`n" "https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf"
```
```powershell
curl.exe -sS -L -r 0-1048575 -o NUL -w "range: status %{http_code}  bytes %{size_download}`n" "https://huggingface.co/nvidia/Nemotron-3-Diarization/resolve/f667ed73aee57d40cc39428eb768b4fd87a0a29e/Nemotron-3-Diarization.q8_0.gguf"
```
```powershell
curl.exe -sS -o NUL -r 0-0 -w "%{certs}" "https://huggingface.co/" | Select-String '^Issuer:'
```

**Send back:** the lines they print. On this PC they read `status 200 redirects 1 … final host us.aws.cdn.hf.co`,
`range: status 206 bytes 1048576` and `Issuer:C=US, O=Amazon, …`. An issuer with your company's name means its
network inspects the connection. That's fine, and worth knowing.

## 9. Read the transcripts (20 minutes)

Open the files in `scripts\spikes\local-stt\out\transcripts\` whose names end in `.vs-elevenlabs.txt` (written by
task 1). Start with `37min.pipe.par.t8.vs-elevenlabs.txt`, which is the whole recording; play the recording beside
it.

**Send back:** could it be used without ElevenLabs? Where do the speaker labels slip?

## 10. Tidy up, and send the results

```powershell
powercfg /getactivescheme
```

This should name your usual scheme (Balanced). Then:

```powershell
node scripts/spikes/local-stt/summarize.mjs
```

**Send back:**
- `scripts\spikes\local-stt\out\summary.md`: numbers only, no transcript text;
- the lines from task 8;
- your answers to task 9.

Afterwards you can remove the two schemes (`setup-emulation.ps1 -Remove`) and delete `scripts\spikes\local-stt\out\`
(several GB). Keep `out\` until part B is done.

# Phase 37, Task 3: the app's own worker (describe.exe --stt-worker) on the PC's graphics cards and the processor.
#
# Unlike run-gpu.ps1 (NVIDIA's CLI), this runs the worker DeScribe ships: both models in one process on two threads,
# one 30 s piece at a time, on the engines in src-tauri/stt-runtime/ (processor) and stt-runtime/vulkan/ (cards). Each
# run is under pinrun --profile unpinned, for the cards' engine use and memory and the job's CPU time and commit.
# Output, in out\worker-gpu\: <label>.jsonl (the worker's events), .log (the engine's stderr), .pinrun.json, .job.json.
# Then: node scripts/spikes/local-stt/check-worker-gpu.mjs (compares every card run with the processor's).
#
# -Devices: cpu, and 0, 1, … for the Nth card the Vulkan engine lists (default cpu 0 1). -Lengths: 5min, 37min, 1h.
# -Repeat N: each run N times (labels .r2, .r3, …). -Exe: the describe.exe to use (default the debug build).
param(
  [string[]]$Devices = @('cpu', '0', '1'),
  [string[]]$Lengths = @('5min', '37min'),
  [int]$Repeat = 1,
  [string]$Exe = ''
)
$ErrorActionPreference = 'Stop'
$Spike = $PSScriptRoot
$Repo = Resolve-Path (Join-Path $Spike '..\..\..')
$PinRun = Join-Path $Spike 'harness\target\release\pinrun.exe'
if (-not $Exe) { $Exe = Join-Path $Repo 'src-tauri\target\debug\describe.exe' }
$Cpu = Join-Path $Repo 'src-tauri\stt-runtime'
$Vulkan = Join-Path $Cpu 'vulkan'
$Pack = Join-Path $Repo '.speech-pack\nvidia-parakeet-nemotron-1'
$Rec = @{
  '5min' = Join-Path $Spike 'out\test-set\test_audio.5min.m4a'
  '37min' = Join-Path $Repo 'tests\audio\test_audio.m4a'
  '1h' = Join-Path $Spike 'out\test-set\test_audio.1h.m4a'
}
$Words = Join-Path $Pack 'parakeet-tdt-0.6b-v3.q8_0.gguf'
$Speakers = Join-Path $Pack 'Nemotron-3-Diarization.q8_0.gguf'
foreach ($p in $PinRun, $Exe, (Join-Path $Vulkan 'ggml-vulkan.dll'), $Words, $Speakers) {
  if (-not (Test-Path $p)) { throw "$p is missing." }
}
$Out = Join-Path $Spike 'out\worker-gpu'
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# The cards, as the app's probe lists them.
$probe = & $Exe --stt-worker --devices $Vulkan 2>$null | ConvertFrom-Json
$Cards = @($probe.devices)
Write-Host "Cards: $(($Cards | ForEach-Object { $_.name }) -join '; ')"

foreach ($device in $Devices) {
  if ($device -eq 'cpu') {
    $runtime = $Cpu; $card = $null; $tag = 'cpu'
  } else {
    $at = [int]$device
    if ($at -ge $Cards.Count) { throw "There is no card $at." }
    $name = $Cards[$at].name
    $nth = @($Cards[0..$at] | Where-Object { $_.name -eq $name }).Count - 1
    $runtime = $Vulkan; $card = @{ name = $name; nth = $nth }; $tag = "gpu$at"
  }
  foreach ($length in $Lengths) {
    foreach ($r in 1..$Repeat) {
      $label = "worker.$tag.$length" + $(if ($r -gt 1) { ".r$r" } else { '' })
      $job = [ordered]@{
        recording = $Rec[$length]; runtimeDir = $runtime; wordsModel = $Words; speakersModel = $Speakers
      }
      if ($card) { $job.device = $card }
      $jobFile = Join-Path $Out "$label.job.json"
      $job | ConvertTo-Json -Compress | Set-Content -Encoding utf8NoBOM $jobFile
      Write-Host "$(Get-Date -Format HH:mm:ss) $label …"
      & $PinRun --profile unpinned --report (Join-Path $Out "$label.pinrun.json") -- $Exe --stt-worker --job $jobFile `
        1> (Join-Path $Out "$label.jsonl") 2> (Join-Path $Out "$label.log")
      $code = $LASTEXITCODE
      $last = Get-Content (Join-Path $Out "$label.jsonl") -Tail 1 | ConvertFrom-Json -ErrorAction SilentlyContinue
      if ($last.event -eq 'done') {
        $t = $last.timings
        Write-Host ("  {0:N1} s for {1:N0} s of audio ({2:N1}x), {3} words, {4} segments" -f $t.totalSec, $last.durationSec,
          ($last.durationSec / $t.totalSec), $last.words.Count, $last.speakerSegments.Count)
      } else {
        Write-Host "  exit $code, last event: $($last | ConvertTo-Json -Compress)"
      }
    }
  }
}

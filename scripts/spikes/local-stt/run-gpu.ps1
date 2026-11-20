# Phase 37, Task 1: NVIDIA's prebuilt v0.3.0 Vulkan release on the PC's graphics cards, against the processor.
#
# Not pinned and not capped (pinrun --profile unpinned): this measures the cards, not the work laptop. Each run is
# stt-bench under pinrun, which records per graphics adapter the processes' engine use and GPU memory (dedicated and
# shared), and the job's CPU time. Reports go to out\gpu\, and stt-bench's runs to out\runs\.
#
# The engines are the zips in vendor\ (see docs/reference/local-stt.md, *On the graphics card*). The models are the
# speech pack's (.speech-pack\, npm run desktop:fetch-models). It changes no system setting.
#
# -Devices: any of cpu, vulkan:0, vulkan:1 (default all three, in that order). -Lengths: 5min, 37min.
# -Modes: pipeline (words in 30 s chunks beside the speakers, the app's shape), combined (transcribe --diar-model).
# -NvidiaCpu: also the 5-minute pipeline on NVIDIA's CPU zip (patched ggml), the baseline the app's engine matches.
# -Env NAME=VALUE: extra environment for the engine (for example GGML_VK_PREFER_HOST_MEMORY=1); -Tag adds to labels.
param(
  [string[]]$Devices = @('cpu', 'vulkan:0', 'vulkan:1'),
  [string[]]$Lengths = @('5min', '37min'),
  [string[]]$Modes = @('pipeline', 'combined'),
  [switch]$Warm,
  [switch]$NvidiaCpu,
  [string[]]$Env = @(),
  [string]$Tag = '',
  # The CLI batches a folder's chunks on a GPU; 1 sends them one at a time, as the app's worker does (label: .c1).
  [int]$Concurrency = 0
)
if ($Concurrency -gt 0) { $Tag = "$Tag.c$Concurrency" }

$ErrorActionPreference = 'Stop'
$Spike = $PSScriptRoot
$Repo = Resolve-Path (Join-Path $Spike '..\..\..')
$Bin = Join-Path $Spike 'harness\target\release'
$PinRun = Join-Path $Bin 'pinrun.exe'
$SttBench = Join-Path $Bin 'stt-bench.exe'
$Vulkan = Join-Path $Spike 'vendor\nemo-speech-0.3.0-windows-x86_64-vulkan\bin\nemo-speech-0.3.0-windows-x86_64-vulkan\bin'
$Cpu = Join-Path $Spike 'vendor\nemo-speech-0.3.0-windows-x86_64-cpu\bin\nemo-speech-0.3.0-windows-x86_64-cpu\bin'
$Pack = Join-Path $Repo '.speech-pack\nvidia-parakeet-nemotron-1'
$Asr = Join-Path $Pack 'parakeet-tdt-0.6b-v3.q8_0.gguf'
$Diar = Join-Path $Pack 'Nemotron-3-Diarization.q8_0.gguf'
$Rec = @{
  '5min' = Join-Path $Spike 'out\test-set\test_audio.5min.m4a'
  '37min' = Join-Path $Repo 'tests\audio\test_audio.m4a'
}
foreach ($p in $PinRun, $SttBench, (Join-Path $Vulkan 'nemo-speech.exe'), $Asr, $Diar) {
  if (-not (Test-Path $p)) { throw "$p is missing." }
}
$Reports = Join-Path $Spike 'out\gpu'
New-Item -ItemType Directory -Force -Path $Reports | Out-Null

foreach ($pair in $Env) {
  $name, $value = $pair -split '=', 2
  Set-Item -Path "env:$name" -Value $value
}

function Invoke-Run([string]$Engine, [string]$EngineName, [string]$Device, [string]$Length, [string]$Mode, [string]$Suffix) {
  $label = "gpu.$EngineName.$($Device -replace ':', '').$Length.$Mode$Tag$Suffix"
  $benchArgs = @($Rec[$Length], '--asr', $Asr, '--diar', $Diar, '--diar-preset', 'v3-offline', '--threads', '8',
    '--device', $Device, '--bin', $Engine, '--mode', $Mode, '--label', $label)
  if ($Mode -eq 'pipeline') { $benchArgs += @('--chunk-sec', '30', '--overlap-sec', '2', '--parallel') }
  if ($Concurrency -gt 0) { $benchArgs += @('--concurrency', "$Concurrency") }
  Write-Host "$(Get-Date -Format HH:mm:ss) $label …"
  & $PinRun --profile unpinned --report (Join-Path $Reports "$label.pinrun.json") -- $SttBench @benchArgs 2>&1 |
    Where-Object { "$_" -match 'real time|pinrun:|error|failed' } | ForEach-Object { Write-Host "  $_" }
  if ($LASTEXITCODE -ne 0) { Write-Host "  exit $LASTEXITCODE" }
}

if ($NvidiaCpu) { Invoke-Run $Cpu 'nvcpu' 'cpu' '5min' 'pipeline' '' }
foreach ($device in $Devices) {
  foreach ($length in $Lengths) {
    foreach ($mode in $Modes) {
      Invoke-Run $Vulkan 'vk' $device $length $mode ''
      # The first run on a card builds its pipelines; a repeat straight after is the warm one.
      if ($Warm -and $length -eq '5min' -and $mode -eq 'pipeline') { Invoke-Run $Vulkan 'vk' $device $length $mode '.warm' }
    }
  }
}

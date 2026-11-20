# Phase 37, Task 3: does ending the worker during a run on a card free the card at once, and does the next run start?
#
# Starts the worker on a card with run-worker-gpu.ps1's 37-minute job (out\worker-gpu\worker.gpu<N>.37min.job.json),
# waits -AfterSec, ends it as Cancel does (the app ends its job object; this ends the process, the same
# TerminateProcess underneath), and samples the card's memory every 100 ms (`\GPU Adapter Memory(*)`, all processes)
# until it is back to what it was before the run. Then runs the 5-minute job on the same card to the end.
# Run it with nothing else using the card. Prints one line per card; nothing is written.
param(
  [string[]]$Cards = @('0', '1'),
  [int]$AfterSec = 12
)
$ErrorActionPreference = 'Stop'
$Spike = $PSScriptRoot
$Repo = Resolve-Path (Join-Path $Spike '..\..\..')
$Exe = Join-Path $Repo 'src-tauri\target\debug\describe.exe'
$Out = Join-Path $Spike 'out\worker-gpu'

# Each adapter's memory in use, all processes together, keyed by its LUID.
function Get-AdapterMemory {
  $samples = (Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage', '\GPU Adapter Memory(*)\Shared Usage').CounterSamples
  $by = @{}
  foreach ($s in $samples) {
    $luid = ($s.InstanceName -replace '_phys.*$', '')
    if (-not $by[$luid]) { $by[$luid] = 0 }
    $by[$luid] += $s.CookedValue
  }
  $by
}

foreach ($card in $Cards) {
  $long = Join-Path $Out "worker.gpu$card.37min.job.json"
  $short = Join-Path $Out "worker.gpu$card.5min.job.json"
  foreach ($p in $long, $short) { if (-not (Test-Path $p)) { throw "$p is missing: run run-worker-gpu.ps1 first." } }

  $before = Get-AdapterMemory
  $p = Start-Process $Exe -ArgumentList '--stt-worker', '--job', "`"$long`"" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Out "cancel.gpu$card.jsonl") -RedirectStandardError (Join-Path $Out "cancel.gpu$card.log")
  Start-Sleep -Seconds $AfterSec
  $during = Get-AdapterMemory
  # The adapter whose memory grew most is the card the run is on.
  $luid = ($during.Keys | Sort-Object { $during[$_] - $before[$_] } -Descending)[0]
  $grew = ($during[$luid] - $before[$luid]) / 1MB

  $clock = [Diagnostics.Stopwatch]::StartNew()
  Stop-Process -Id $p.Id -Force
  $p.WaitForExit()
  $exited = $clock.Elapsed.TotalMilliseconds
  $freed = $null
  while ($clock.Elapsed.TotalSeconds -lt 10) {
    $now = Get-AdapterMemory
    if ($now[$luid] - $before[$luid] -lt 32MB) { $freed = $clock.Elapsed.TotalMilliseconds; break }
    Start-Sleep -Milliseconds 100
  }

  $next = & $Exe --stt-worker --job $short 2>$null | Select-Object -Last 1 | ConvertFrom-Json
  $nextOk = $next.event -eq 'done' -and $next.words.Count -gt 0
  Write-Host ("Card {0} ({1}): {2:N0} MB in use after {3} s; ended in {4:N0} ms; memory back in {5}; the next run {6}" -f `
    $card, $luid, $grew, $AfterSec, $exited, $(if ($null -ne $freed) { '{0:N0} ms' -f $freed } else { '**over 10 s**' }),
    $(if ($nextOk) { "finished ($($next.words.Count) words, $('{0:N1}' -f $next.timings.totalSec) s)" } else { "**failed: $($next | ConvertTo-Json -Compress)**" }))
}

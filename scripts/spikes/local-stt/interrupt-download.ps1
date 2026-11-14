# Phase 33 spike, maintainer task 7 (D8): what an interrupted model download leaves behind, and whether it carries on.
#
# It downloads NVIDIA's Parakeet file (714 MB, from huggingface.co, pinned in models.json) into out\dl\ three times
# with the download prototype (hf-fetch, WinHTTP), and asks you to interrupt each one:
#   1. turn the network off part-way, then on again;
#   2. put the PC to sleep part-way, then wake it;
#   3. close the download's window part-way.
# After each interruption it runs the download again and records whether it resumed. It changes no setting itself:
# you turn the network off and on, and you put the PC to sleep. The files in out\dl\ can be deleted afterwards.
#
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\interrupt-download.ps1 [-Steps 1,2]
param([int[]]$Steps = @(1, 2, 3))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'emulation.ps1')

if (-not (Test-Path $HfFetch)) { throw "$HfFetch is missing: build the harness first." }
$models = Get-Content (Join-Path $Spike 'models.json') -Raw | ConvertFrom-Json
$m = $models.models | Where-Object id -eq 'parakeet-tdt-0.6b-v3'
$url = "https://huggingface.co/$($m.repo)/resolve/$($m.revision)/$($m.file)"
$dl = Join-Path $Out 'dl'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
$target = Join-Path $dl $m.file
$part = "$target.part"

function Start-Fetch([string]$Name, [switch]$Visible) {
  $report = Join-Path $dl "d8-$Name.json"
  # 5 MB/s: on a fast connection the file would be done in seconds, before anyone could interrupt it.
  $argList = @($url, '--out', $target, '--bytes', "$($m.bytes)", '--sha256', $m.sha256, '--report', $report, '--timeout-sec', '30', '--max-mbps', '5')
  $style = if ($Visible) { 'Normal' } else { 'Minimized' }
  Start-Process -FilePath $HfFetch -ArgumentList $argList -PassThru -WindowStyle $style
}

# Waits until the download has written $MinMB; stops the script with the report if the download fails first.
function Wait-Part($Process, [string]$Name, [int]$MinMB) {
  while (-not (Test-Path $part) -or (Get-Item $part).Length -lt $MinMB * 1MB) {
    if ($Process.HasExited) {
      $r = Read-Report $Name
      throw "The download stopped before $MinMB MB ($($r.error.kind): $($r.error.detail)). Check the network, then run this script again."
    }
    Start-Sleep -Milliseconds 500
  }
}

# Waits until huggingface.co resolves again: Wi-Fi takes a few seconds to reconnect after it's turned back on.
function Wait-Online {
  $shown = $false
  while ($true) {
    try { [void][System.Net.Dns]::GetHostAddresses('huggingface.co'); break } catch {
      if (-not $shown) { Write-Host '  (waiting for the network to come back …)'; $shown = $true }
      Start-Sleep -Seconds 2
    }
  }
  Start-Sleep -Seconds 2
}

function Part-MB { if (Test-Path $part) { [math]::Round((Get-Item $part).Length / 1MB) } else { 0 } }

function Read-Report([string]$Name) {
  $path = Join-Path $dl "d8-$Name.json"
  if (Test-Path $path) { Get-Content $path -Raw | ConvertFrom-Json } else { $null }
}

function Reset-Files { Remove-Item -Force -ErrorAction SilentlyContinue $target, $part }

$results = [ordered]@{}
Wait-Online

# 1. The network goes away.
if ($Steps -contains 1) {
Reset-Files
Write-Host "`n1 of 3: the network drops." -ForegroundColor Cyan
$p = Start-Fetch 'network-1'
Wait-Part $p 'network-1' 100
Read-Host 'Turn the network off now (Wi-Fi off, or unplug the cable). Press Enter once it is off'
$p | Wait-Process -Timeout 120 -ErrorAction SilentlyContinue
if (-not $p.HasExited) { Write-Host '  (still waiting for the connection to time out …)'; $p | Wait-Process }
$results.network = [ordered]@{ leftBehindMB = (Part-MB); first = (Read-Report 'network-1') }
Read-Host 'Turn the network back on. Press Enter once it is on'
Wait-Online
$p = Start-Fetch 'network-2'
$p | Wait-Process
$results.network.second = Read-Report 'network-2'
}

# 2. The PC sleeps.
if ($Steps -contains 2) {
Reset-Files
Write-Host "`n2 of 3: the PC sleeps." -ForegroundColor Cyan
Wait-Online
$p = Start-Fetch 'sleep-1'
Wait-Part $p 'sleep-1' 100
Read-Host 'Put the PC to sleep now (Start > Power > Sleep). Wake it after about a minute, sign in, then press Enter'
$p | Wait-Process
$results.sleep = [ordered]@{ leftBehindMB = (Part-MB); first = (Read-Report 'sleep-1') }
if (-not (Test-Path $target)) {
  Wait-Online
  $p = Start-Fetch 'sleep-2'
  $p | Wait-Process
  $results.sleep.second = Read-Report 'sleep-2'
}
}

# 3. The window is closed.
if ($Steps -contains 3) {
Reset-Files
Write-Host "`n3 of 3: the download's window is closed." -ForegroundColor Cyan
Wait-Online
$p = Start-Fetch 'close-1' -Visible
Wait-Part $p 'close-1' 100
Read-Host "Close the window titled hf-fetch.exe (its X), then press Enter here"
$results.close = [ordered]@{ leftBehindMB = (Part-MB); exitedBeforeEnd = $p.HasExited }
Wait-Online
$p = Start-Fetch 'close-2'
$p | Wait-Process
$results.close.second = Read-Report 'close-2'
}

$summaryPath = Join-Path $dl 'd8-summary.json'
if (Test-Path $summaryPath) {
  $old = Get-Content $summaryPath -Raw | ConvertFrom-Json
  foreach ($prop in $old.PSObject.Properties) { if (-not $results.Contains($prop.Name)) { $results[$prop.Name] = $prop.Value } }
}
$results | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $summaryPath
Reset-Files
node (Join-Path $Spike 'summarize.mjs')
Write-Host "`nDone: out\dl\d8-summary.json and out\summary.md. The downloaded file was deleted."

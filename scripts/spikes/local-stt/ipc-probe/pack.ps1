# Phase 33 spike: builds the STT probe and packs it twice, as versions 1.0.0.0 and 2.0.0.0 of the test identity
# DeScribe.SttProbe, signed with the development certificate (devcert.pfx at the repo root, made here on first use
# as scripts/pack-desktop.mjs does; never committed). Output: out\ipc-probe\DeScribe.SttProbe-<version>.msix.
#
# Installing them is the maintainer's step (docs/phases/33-maintainer-guide.md): trusting the certificate needs
# administrator rights, once.
#
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\spikes\local-stt\ipc-probe\pack.ps1
$ErrorActionPreference = 'Stop'
$Probe = $PSScriptRoot
$Spike = Split-Path $Probe
$Repo = Resolve-Path (Join-Path $Spike '..\..\..')
$Out = Join-Path $Spike 'out\ipc-probe'
$Cert = Join-Path $Repo 'devcert.pfx'
$env:WINAPP_CLI_TELEMETRY_OPTOUT = '1'

Push-Location $Probe
try {
  cargo build --release --features custom-protocol
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$exe = Join-Path $Probe 'target\release\describe-stt-probe.exe'

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$manifest = Get-Content (Join-Path $Probe 'msix\Package.appxmanifest') -Raw
foreach ($version in '1.0.0.0', '2.0.0.0') {
  $stage = Join-Path $Probe "target\msix-$version"
  $manifestDir = Join-Path $Probe "target\msix-manifest-$version"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $stage, $manifestDir
  New-Item -ItemType Directory -Force -Path $stage, $manifestDir | Out-Null
  Copy-Item $exe (Join-Path $stage 'describe-stt-probe.exe')
  Copy-Item -Recurse (Join-Path $Repo 'src-tauri\msix\Assets') (Join-Path $stage 'Assets')
  $staged = Join-Path $manifestDir 'Package.appxmanifest'
  ($manifest -replace '(<Identity\b[^>]*?\bVersion=")[^"]*(")', "`${1}$version`${2}") | Set-Content -NoNewline -Encoding utf8 $staged
  if (-not (Test-Path $Cert)) {
    winapp cert generate --manifest $staged --output $Cert --if-exists skip
    if ($LASTEXITCODE -ne 0) { throw "winapp cert generate failed ($LASTEXITCODE)" }
  }
  $msix = Join-Path $Out "DeScribe.SttProbe-$version.msix"
  winapp pack $stage --manifest $staged --output $msix --cert $Cert
  if ($LASTEXITCODE -ne 0) { throw "winapp pack failed ($LASTEXITCODE)" }
  Write-Host "Packed $msix ($([math]::Round((Get-Item $msix).Length / 1MB, 1)) MB)."
}

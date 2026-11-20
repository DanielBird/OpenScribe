# Builds the speech engines the desktop app ships (DECISIONS.md D51, D53, D58), as src-tauri/stt-runtime.json defines
# them: NVIDIA's NeMo-Speech.cpp at a pinned commit, for the work laptop's instruction sets (AVX2, FMA, F16C, BMI2; no
# AVX-512, AVX-VNNI or native tuning), twice:
#   - the processor engine, into src-tauri/stt-runtime/ (gitignored): CPU only, no CUDA or Vulkan. The build Phase 33
#     benchmarked (scripts/spikes/local-stt/build-runtime.ps1);
#   - the Vulkan engine (Phase 37), into src-tauri/stt-runtime/vulkan/: the same source with -Backend vulkan, stock
#     ggml as NVIDIA builds Vulkan. Its ggml.dll imports ggml-vulkan.dll, which imports the driver's vulkan-1.dll, so
#     it can't stand in for the processor engine on a computer without Vulkan.
#
# Each folder gets the MSVC and OpenMP runtimes the DLLs import (msvcp140, vcruntime140, vcruntime140_1, vcomp140),
# copied from Visual Studio's redistributable folder, and a built.json: each file's size and SHA-256, which
# pack-desktop.mjs checks before staging them. The script refuses a build whose CMake flags or DLL imports aren't what
# stt-runtime.json says.
#
# Needs: Visual Studio 2022 with the C++ tools, CMake, Ninja and git (reference/local-stt.md, Prerequisites); for the
# Vulkan engine also the LunarG Vulkan SDK of the version stt-runtime.json names. The first build of each engine takes
# about 10 minutes (vcpkg builds sentencepiece and protobuf); later ones about 2.
#
# Usage: npm run desktop:stt-runtime                                     (both engines, in .stt-runtime-build/)
#        npm run desktop:stt-runtime -- -Only vulkan                     (one engine; the other folder is kept)
#        npm run desktop:stt-runtime -- -Only cpu -From <bin folder>     (copies an existing build of the same commit
#                                                                         instead of building; its flags are checked
#                                                                         when its CMakeCache.txt is beside bin\)
param([ValidateSet('cpu', 'vulkan')][string]$Only, [string]$From, [switch]$Clean)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Definition = Get-Content (Join-Path $Root 'src-tauri\stt-runtime.json') -Raw | ConvertFrom-Json
$Out = Join-Path $Root 'src-tauri\stt-runtime'
$Work = Join-Path $Root '.stt-runtime-build'

if ($From -and -not $Only) { throw 'Say which build this is: -Only cpu or -Only vulkan.' }

$Builds = @(
  [ordered]@{
    backend = 'cpu'
    build = $Definition
    out = $Out
    buildDir = Join-Path $Work 'build-cpu-asr'
    mustBeOff = 'GGML_NATIVE', 'GGML_AVX512', 'GGML_AVX_VNNI', 'GGML_CUDA', 'GGML_VULKAN'
    mustBeOn = @()
  },
  [ordered]@{
    backend = 'vulkan'
    build = $Definition.vulkan
    out = Join-Path $Out $Definition.vulkan.folder
    buildDir = Join-Path $Work 'build-vulkan-asr'
    mustBeOff = 'GGML_NATIVE', 'GGML_AVX512', 'GGML_AVX_VNNI', 'GGML_CUDA', 'NEMO_SPEECH_GGML_PATCHED'
    mustBeOn = @('GGML_VULKAN')
  }
) | Where-Object { -not $Only -or $_.backend -eq $Only }

$vsPath = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio with the C++ tools is needed (vswhere found none).' }
$toolsets = Get-ChildItem (Join-Path $vsPath 'VC\Tools\MSVC') -Directory | Sort-Object { [version]$_.Name } -Descending
$dumpbin = Join-Path $toolsets[0].FullName 'bin\Hostx64\x64\dumpbin.exe'
if (-not (Test-Path $dumpbin)) { throw "dumpbin isn't at $dumpbin; it checks the engine's imports." }

# The newest redistributable at least as new as the toolset the DLLs were built with.
$redist = Get-ChildItem (Join-Path $vsPath 'VC\Redist\MSVC') -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $redist -or [version]$redist.Name -lt [version]"$($Definition.msvcRuntime.minimumVersion).0") {
  throw "Visual Studio's redistributable MSVC runtime $($Definition.msvcRuntime.minimumVersion) or newer is needed."
}
$runtimeFrom = @{
  'msvcp140.dll' = 'x64\Microsoft.VC143.CRT'
  'vcruntime140.dll' = 'x64\Microsoft.VC143.CRT'
  'vcruntime140_1.dll' = 'x64\Microsoft.VC143.CRT'
  'vcomp140.dll' = 'x64\Microsoft.VC143.OpenMP'
}

# The Vulkan SDK, before anything is built. Shells opened before the SDK was installed don't have VULKAN_SDK, so read
# it as NVIDIA's build.ps1 does: this process, then the machine's and the user's environment.
function Get-VulkanSdk {
  $sdk = $env:VULKAN_SDK
  if (-not $sdk) { $sdk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'Machine') }
  if (-not $sdk) { $sdk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'User') }
  if (-not $sdk -or -not (Test-Path (Join-Path $sdk 'Bin\glslc.exe'))) { return $null }
  return $sdk
}
$wanted = $Definition.vulkan.vulkanSdk
$installSdk = "The Vulkan engine needs the LunarG Vulkan SDK ${wanted}: winget install --id KhronosGroup.VulkanSDK -e " +
  "--version $wanted, then open a new terminal."
$vulkanSdk = $null
if (($Builds | Where-Object { $_.backend -eq 'vulkan' }) -and -not $From) {
  $sdk = Get-VulkanSdk
  if (-not $sdk) { throw $installSdk }
  $vulkanSdk = Split-Path $sdk -Leaf
  if ($vulkanSdk -ne $wanted) {
    throw "VULKAN_SDK is $sdk ($vulkanSdk), but stt-runtime.json names $wanted. Install $wanted, or check what the " +
      'new SDK changes in the engine and its notices, then update vulkan.vulkanSdk.'
  }
  $env:VULKAN_SDK = $sdk
}

# The source, once for both builds.
if (-not $From) {
  $src = Join-Path $Work 'nemo-speech'
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (-not (Test-Path $src)) {
    git clone --branch $Definition.tag --depth 1 "$($Definition.repository).git" $src
    if ($LASTEXITCODE -ne 0) { throw "git clone failed ($LASTEXITCODE)" }
  }
  $head = (git -C $src rev-parse HEAD).Trim()
  if ($head -ne $Definition.commit) { throw "$src is at $head, expected $($Definition.commit)" }
  if (-not (Test-Path (Join-Path $src 'llama.cpp\ggml\CMakeLists.txt'))) {
    git -C $src submodule update --init --depth 1 llama.cpp
    if ($LASTEXITCODE -ne 0) { throw "git submodule update failed ($LASTEXITCODE)" }
  }
  $llama = (git -C (Join-Path $src 'llama.cpp') rev-parse HEAD).Trim()
  if ($llama -ne $Definition.llamaCppCommit) { throw "llama.cpp is at $llama, expected $($Definition.llamaCppCommit)" }

  # vcpkg builds with the newest MSVC toolset installed while vcvars64.bat picks VS's pinned default, which can be
  # older; the link then fails on STL symbols (__std_search_1). vcvars honours VCVARS_USER_VERSION.
  $env:VCVARS_USER_VERSION = $toolsets[0].Name
  Write-Host "==> MSVC toolset $($env:VCVARS_USER_VERSION)"
}

# What CMake actually used: refuse a build that turned on anything the laptop lacks, or the wrong backend.
function Assert-CMakeFlags($cacheFile, $spec) {
  $cache = Get-Content $cacheFile
  foreach ($flag in $spec.mustBeOff) {
    $line = $cache | Where-Object { $_ -match "^${flag}:[A-Z]+=" }
    if ($line -and $line -notmatch '=(OFF|FALSE|0)$') {
      throw "CMake used $line; the $($spec.backend) engine must be built without it"
    }
  }
  foreach ($flag in $spec.mustBeOn) {
    $line = $cache | Where-Object { $_ -match "^${flag}:[A-Z]+=" }
    if (-not $line -or $line -notmatch '=(ON|TRUE|1)$') {
      throw "CMake didn't use ${flag}=ON ($line); the $($spec.backend) engine must be built with it"
    }
  }
  return $cache
}

# Each engine file's imports: in the folder, or Windows' own (System32 or an API set). The processor engine imports
# nothing of Vulkan's; the Vulkan engine's ggml.dll imports ggml-vulkan.dll, which imports the driver's vulkan-1.dll.
function Assert-Imports($dir, $spec) {
  $here = Get-ChildItem $dir -File -Filter *.dll | ForEach-Object { $_.Name.ToLower() }
  $imports = @{}
  foreach ($name in $spec.build.engineFiles) {
    $lines = & $dumpbin /nologo /dependents (Join-Path $dir $name)
    if ($LASTEXITCODE -ne 0) { throw "dumpbin couldn't read $name ($LASTEXITCODE)" }
    $deps = @($lines | Where-Object { $_ -match '^\s{4}(\S+\.dll)\s*$' } | ForEach-Object { $Matches[1].ToLower() })
    $imports[$name] = $deps
    foreach ($dep in $deps) {
      $windows = $dep -match '^(api|ext)-ms-' -or (Test-Path (Join-Path $env:SystemRoot "System32\$dep"))
      if ($here -notcontains $dep -and -not $windows) {
        throw "$name imports $dep, which isn't in $dir or Windows. Add it to engineFiles in stt-runtime.json."
      }
    }
  }
  if ($spec.backend -eq 'cpu') {
    foreach ($name in $imports.Keys) {
      $vulkan = $imports[$name] | Where-Object { $_ -in 'ggml-vulkan.dll', 'vulkan-1.dll' }
      if ($vulkan) { throw "The processor engine's $name imports $vulkan; it must load without Vulkan." }
    }
  } else {
    if ($imports['ggml.dll'] -notcontains 'ggml-vulkan.dll') { throw "The Vulkan engine's ggml.dll doesn't import ggml-vulkan.dll." }
    if ($imports['ggml-vulkan.dll'] -notcontains 'vulkan-1.dll') { throw "ggml-vulkan.dll doesn't import vulkan-1.dll." }
  }
}

function Build-Engine($spec) {
  $usedSdk = $null
  if ($From) {
    $bin = (Resolve-Path $From).Path
    $source = "copied from $bin"
    $cacheFile = Join-Path (Split-Path $bin -Parent) 'CMakeCache.txt'
    if (Test-Path $cacheFile) {
      $cache = Assert-CMakeFlags $cacheFile $spec
      if ($spec.backend -eq 'vulkan') {
        # The SDK the copied build used, from the paths CMake found in it.
        $paths = $cache | Where-Object { $_ -match '^Vulkan_(GLSLC_EXECUTABLE|INCLUDE_DIR):' }
        $found = $paths | Where-Object { $_ -match 'VulkanSDK[\\/]([\d.]+)[\\/]' } | ForEach-Object { $Matches[1] } |
          Select-Object -First 1
        if ($found -and $found -ne $wanted) {
          throw "$bin was built with the Vulkan SDK $found, but stt-runtime.json names $wanted."
        }
        $usedSdk = $found
      }
    } else {
      Write-Warning "No CMakeCache.txt beside $bin, so its build flags weren't checked."
    }
  } else {
    if ($Clean -and (Test-Path $spec.buildDir)) { Remove-Item -Recurse -Force $spec.buildDir }
    Write-Host "==> Building the $($spec.backend) engine in $($spec.buildDir)"
    & (Join-Path $src 'scripts\windows\build.ps1') -Backend $spec.backend -Profile asr -Compiler msvc -Config Release `
      -VcpkgRoot (Join-Path $Work 'vcpkg') -BuildDir $spec.buildDir -CMakeArgs $spec.build.cmakeArgs
    if (-not $?) { throw "NeMo-Speech.cpp's $($spec.backend) build failed" }
    Assert-CMakeFlags (Join-Path $spec.buildDir 'CMakeCache.txt') $spec | Out-Null
    $bin = Join-Path $spec.buildDir 'bin'
    $source = "built from $($Definition.repository) $($Definition.tag) ($($Definition.commit))"
    if ($spec.backend -eq 'vulkan') { $usedSdk = $vulkanSdk }
  }

  # The processor engine's folder also holds vulkan\: clear only its own files.
  if ($spec.backend -eq 'cpu') {
    New-Item -ItemType Directory -Force -Path $spec.out | Out-Null
    Get-ChildItem $spec.out -File | Remove-Item -Force
  } else {
    if (Test-Path $spec.out) { Remove-Item -Recurse -Force $spec.out }
    New-Item -ItemType Directory -Force -Path $spec.out | Out-Null
  }
  foreach ($name in $spec.build.engineFiles) {
    $file = Join-Path $bin $name
    if (-not (Test-Path $file)) { throw "$name isn't in $bin" }
    Copy-Item $file $spec.out
  }
  foreach ($name in $Definition.msvcRuntime.files) {
    Copy-Item (Join-Path $redist.FullName (Join-Path $runtimeFrom[$name] $name)) $spec.out
  }
  Assert-Imports $spec.out $spec

  $files = Get-ChildItem $spec.out -File -Filter *.dll | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() }
  }
  $built = [ordered]@{
    name = $Definition.name
    version = $Definition.version
    commit = $Definition.commit
    backend = $spec.backend
    source = $source
    msvcRuntime = $redist.Name
  }
  if ($spec.backend -eq 'vulkan') { $built.vulkanSdk = if ($usedSdk) { $usedSdk } else { 'unknown' } }
  $built.builtAt = (Get-Date).ToString('o')
  $built.files = $files
  $built | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $spec.out 'built.json')
  $total = ($files | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum
  $relative = $spec.out.Substring($Root.Length + 1)
  $script:summary += "$($spec.backend): $($files.Count) files in $relative, $([math]::Round($total / 1MB, 1)) MB ($source)"
}

# Not collected from the function's output, which carries the build's own log.
$summary = @()
foreach ($spec in $Builds) { Build-Engine $spec }
$summary | ForEach-Object { Write-Host $_ }
Write-Host "MSVC runtime $($redist.Name)."

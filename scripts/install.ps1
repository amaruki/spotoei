# Install SPOTOEI from the latest GitHub release.
#
#   irm https://raw.githubusercontent.com/amaruki/spotoei/main/scripts/install.ps1 | iex
#
# Options (environment variables):
#   $env:SPOTOEI_VERSION        Install a specific version instead of the latest
#   $env:SPOTOEI_INSTALL_DIR    Install directory (default: %LOCALAPPDATA%\Programs\spotoei)

$ErrorActionPreference = "Stop"

$repo = "amaruki/spotoei"
$version = $env:SPOTOEI_VERSION
$installDir = $env:SPOTOEI_INSTALL_DIR

if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA "Programs\spotoei" }

switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "X64" { $arch = "x86_64" }
    "Arm64" { $arch = "arm64" }
    default { throw "Unsupported architecture: $_. See docs/INSTALL.md for manual install." }
}

if (-not $version) {
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
    $version = $release.tag_name.TrimStart("v")
}

$archive = "spotoei-v$version-windows-$arch.tar.gz"
$base = "https://github.com/$repo/releases/download/v$version"
$tmp = Join-Path $env:TEMP ("spotoei-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Write-Host "Downloading $archive..."
    Invoke-WebRequest "$base/$archive" -OutFile (Join-Path $tmp $archive)
    Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $tmp "SHA256SUMS")

    $expected = ((Get-Content (Join-Path $tmp "SHA256SUMS") -Raw).Trim() -split "\s+")[0].ToLower()
    $actual = (Get-FileHash (Join-Path $tmp $archive) -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw "Checksum mismatch for $archive" }

    New-Item -ItemType Directory -Force $installDir | Out-Null
    tar -xzf (Join-Path $tmp $archive) -C $installDir
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Host "Added $installDir to your user PATH (new terminals pick it up)."
}
if ($env:Path -notlike "*$installDir*") { $env:Path = "$env:Path;$installDir" }

Write-Host ""
Write-Host "Installed SPOTOEI v$version to $installDir"
Write-Host ""
Write-Host "Start it with:"
Write-Host ""
Write-Host "  spotoei"

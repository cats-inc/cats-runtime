#!/usr/bin/env pwsh
# Pack cats-runtime as .tgz and optionally install it globally.
#
# Usage:
#   .\scripts\windows\Pack-Install.ps1                 # Interactive (install defaults to yes; delete defaults to yes after install)
#   .\scripts\windows\Pack-Install.ps1 -PackOnly       # Build + pack, skip install
#   .\scripts\windows\Pack-Install.ps1 -Install        # Build + pack + install + delete tgz (no prompt)
#   .\scripts\windows\Pack-Install.ps1 -Install -Clean # Build + pack + install + delete tgz
#   .\scripts\windows\Pack-Install.ps1 -SkipBuild      # Pack only (assumes already built)

param(
    [switch]$PackOnly,
    [switch]$Install,
    [switch]$Clean,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
Push-Location $root

function Format-CommandArg {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return '"' + $Value.Replace('"', '\"') + '"'
}

try {
    if (-not $SkipBuild) {
        Write-Host "`n=== Building... ===" -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed"
        }
    } else {
        Write-Host "`n=== Skipping build (-SkipBuild) ===" -ForegroundColor Yellow
    }

    Write-Host "`n=== Packing... ===" -ForegroundColor Cyan
    $env:npm_config_ignore_scripts = 'true'
    $tgzName = (npm pack --silent | Select-Object -Last 1).Trim()
    $env:npm_config_ignore_scripts = $null
    if ($LASTEXITCODE -ne 0) {
        throw "npm pack failed"
    }

    if (-not $tgzName) {
        throw "npm pack did not return a tarball name"
    }

    $tgz = Join-Path $root $tgzName
    $tgzQuoted = Format-CommandArg -Value $tgz

    if (-not (Test-Path $tgz)) {
        throw "Expected $tgz but file not found"
    }

    Write-Host "`nPackage created: $tgz" -ForegroundColor Green

    if ($PackOnly) {
        Write-Host "Pack only mode. Package at: $tgz" -ForegroundColor Gray
        Write-Host "You can install later with: npm install -g $tgzQuoted" -ForegroundColor Gray
        Write-Host "After installing, try: cats-runtime --help" -ForegroundColor Gray
        return
    }

    $shouldInstall = $false
    if ($Install) {
        $shouldInstall = $true
    } else {
        $installAnswer = Read-Host "`nInstall globally? (Y/n)"
        if ($installAnswer -notmatch '^[nN]') {
            $shouldInstall = $true
        }
    }

    if (-not $shouldInstall) {
        Write-Host "Skipped install. Package at: $tgz" -ForegroundColor Gray
        Write-Host "You can install later with: npm install -g $tgzQuoted" -ForegroundColor Gray
        Write-Host "After installing, try: cats-runtime --help" -ForegroundColor Gray
        return
    }

    Write-Host "`n=== Installing globally... ===" -ForegroundColor Cyan
    npm install -g $tgz
    if ($LASTEXITCODE -ne 0) {
        throw "npm install -g failed"
    }

    Write-Host "Installed successfully!" -ForegroundColor Green
    Write-Host "Try: cats-runtime --help" -ForegroundColor Gray

    $shouldDelete = $false
    if ($Clean) {
        $shouldDelete = $true
    } elseif ($Install) {
        $shouldDelete = $true
    } else {
        $deleteAnswer = Read-Host "`nDelete $tgzName? (Y/n)"
        if ($deleteAnswer -notmatch '^[nN]') {
            $shouldDelete = $true
        }
    }

    if ($shouldDelete) {
        Remove-Item $tgz -Force
        Write-Host "Deleted." -ForegroundColor Yellow
    } else {
        Write-Host "Kept at: $tgz" -ForegroundColor Gray
        Write-Host "You can reinstall later with: npm install -g $tgzQuoted" -ForegroundColor Gray
    }
}
finally {
    $env:npm_config_ignore_scripts = $null
    Pop-Location
}

<#
.SYNOPSIS
    Setup cats-runtime to auto-start on Windows boot

.DESCRIPTION
    Creates a runner script and Windows Startup shortcut so cats-runtime starts
    automatically in the background when you log in.

    The runtime is then available at http://localhost:3110 by default.

    This is a user-level script and does not require administrator privileges.

.PARAMETER Install
    Build, create runner script, and add Windows startup shortcut

.PARAMETER Remove
    Remove runner script and startup shortcut

.PARAMETER Verify
    Check if the service is running

.PARAMETER Force
    Force reconfiguration even if already setup

.EXAMPLE
    .\Setup-AutoStart.ps1 -Install

.EXAMPLE
    .\Setup-AutoStart.ps1 -Verify

.EXAMPLE
    .\Setup-AutoStart.ps1 -Remove
#>

param(
    [switch]$Install,
    [switch]$Remove,
    [switch]$Verify,
    [switch]$Force
)

Write-Host "--- Cats Runtime Auto-Start Setup ---" -ForegroundColor Cyan

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptPath "..\..")).Path
$envFile = Join-Path $repoRoot ".env"
$envExample = Join-Path $repoRoot ".env.example"

$userScriptsDir = Join-Path $env:USERPROFILE "Scripts"
$runnerScript = Join-Path $userScriptsDir "Start-CatsRuntime.ps1"
$logFile = Join-Path $userScriptsDir "cats-runtime.log"
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupShortcut = Join-Path $startupFolder "Start-CatsRuntime.lnk"

$port = "3110"
if (Test-Path $envFile) {
    $portLine = Get-Content $envFile | Select-String '^CATS_RUNTIME_PORT\s*='
    if ($portLine) {
        $p = ($portLine.Line -split '=', 2)[1].Trim()
        if ($p) { $port = $p }
    }
}

$ops = @($Install, $Remove, $Verify)
$opCount = ($ops | Where-Object { $_ }).Count

if ($opCount -eq 0) {
    Write-Host ""
    Write-Host "Usage: -Install, -Remove, or -Verify" -ForegroundColor Yellow
    Write-Host "  .\Setup-AutoStart.ps1 -Install" -ForegroundColor White
    Write-Host "  .\Setup-AutoStart.ps1 -Verify" -ForegroundColor White
    Write-Host "  .\Setup-AutoStart.ps1 -Remove" -ForegroundColor White
    exit 1
}

if ($opCount -gt 1) {
    Write-Host "Only one operation at a time" -ForegroundColor Red
    exit 1
}

function Get-AuthHeaders {
    $headers = @{}
    if (Test-Path $envFile) {
        $keyLine = Get-Content $envFile | Select-String '^CATS_RUNTIME_API_KEY\s*='
        if ($keyLine) {
            $apiKey = ($keyLine.Line -split '=', 2)[1].Trim()
            if ($apiKey) { $headers["Authorization"] = "Bearer $apiKey" }
        }
    }
    return $headers
}

if ($Verify) {
    Write-Host ""
    $allGood = $true

    Write-Host "1. HTTP service (localhost:$port)..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest `
            -Uri "http://localhost:$port/health" `
            -TimeoutSec 5 `
            -UseBasicParsing `
            -Headers (Get-AuthHeaders) `
            -ErrorAction Stop
        $health = $null
        try {
            $health = $response.Content | ConvertFrom-Json
        } catch {
            $health = $null
        }

        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
            $status = if ($health -and $health.status) { $health.status } else { "unknown" }
            Write-Host "   OK ($status)" -ForegroundColor Green
            $bootstrapRequired = $false
            if ($health -and $health.startup -and $null -ne $health.startup.bootstrapRequired) {
                $bootstrapRequired = [bool]$health.startup.bootstrapRequired
            }
            if ($bootstrapRequired) {
                Write-Host "   Setup required: bootstrap mode active at http://localhost:$port/" -ForegroundColor Yellow
            }
            if ($health -and $health.backend) {
                $backendBaseUrl = [string]$health.backend.baseUrl
                if ([bool]$health.backend.reachable) {
                    Write-Host "   Backend reachable: $backendBaseUrl" -ForegroundColor Green
                } else {
                    Write-Host "   Backend unreachable: $backendBaseUrl" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "   Unexpected status: $($response.StatusCode)" -ForegroundColor Yellow
            $allGood = $false
        }
    } catch {
        Write-Host "   Not reachable: $($_.Exception.Message)" -ForegroundColor Red
        $allGood = $false
    }

    Write-Host "2. Startup config..." -ForegroundColor Yellow
    if (Test-Path $runnerScript) {
        Write-Host "   Runner script exists" -ForegroundColor Green
    } else {
        Write-Host "   Runner script missing: $runnerScript" -ForegroundColor Red
        $allGood = $false
    }
    if (Test-Path $startupShortcut) {
        Write-Host "   Startup shortcut exists" -ForegroundColor Green
    } else {
        Write-Host "   Startup shortcut missing" -ForegroundColor Red
        $allGood = $false
    }

    Write-Host "3. Log file..." -ForegroundColor Yellow
    if (Test-Path $logFile) {
        $logSize = (Get-Item $logFile).Length
        $logLast = (Get-Item $logFile).LastWriteTime
        Write-Host "   $([math]::Round($logSize/1024, 1)) KB, last updated: $logLast" -ForegroundColor Gray
        Write-Host "   Last 3 lines:" -ForegroundColor Gray
        Get-Content $logFile -Tail 3 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "   No log file yet" -ForegroundColor Gray
    }

    Write-Host ""
    if ($allGood) {
        Write-Host "All good" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "Some issues found, see above" -ForegroundColor Yellow
        exit 1
    }
}

if ($Remove) {
    Write-Host ""

    if (Test-Path $runnerScript) {
        Remove-Item $runnerScript -ErrorAction SilentlyContinue
        Write-Host "Removed runner script" -ForegroundColor Green
    } else {
        Write-Host "Runner script not found, skipping" -ForegroundColor Gray
    }

    if (Test-Path $startupShortcut) {
        Remove-Item $startupShortcut -ErrorAction SilentlyContinue
        Write-Host "Removed startup shortcut" -ForegroundColor Green
    } else {
        Write-Host "Startup shortcut not found, skipping" -ForegroundColor Gray
    }

    if (Test-Path $logFile) {
        Remove-Item $logFile -ErrorAction SilentlyContinue
        Write-Host "Removed log file" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Auto-start removed. Running service is NOT stopped." -ForegroundColor Yellow
    Write-Host "To stop only cats-runtime, use .\Restart-Server.ps1 -Stop" -ForegroundColor Gray
    exit 0
}

if ($Install) {
    Write-Host ""

    Write-Host "1. Checking prerequisites..." -ForegroundColor Yellow

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Host "   Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    Write-Host "   Node.js $(node --version)" -ForegroundColor Green

    if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
        Write-Host "   node_modules missing, running npm install..." -ForegroundColor Yellow
        Push-Location $repoRoot
        npm install 2>&1 | Out-Null
        Pop-Location
    }
    Write-Host "   Dependencies OK" -ForegroundColor Green

    if (-not (Test-Path $envFile)) {
        if (Test-Path $envExample) {
            Copy-Item $envExample $envFile
            Write-Host "   Created .env from .env.example" -ForegroundColor Gray
        }
    }
    Write-Host "   Port: $port" -ForegroundColor Gray

    if ((Test-Path $runnerScript) -and (Test-Path $startupShortcut) -and -not $Force) {
        Write-Host ""
        Write-Host "Already installed. Use -Force to reconfigure." -ForegroundColor Yellow
        Write-Host "   Runner: $runnerScript" -ForegroundColor Gray
        Write-Host "   Shortcut: $startupShortcut" -ForegroundColor Gray
        exit 0
    }

    Write-Host "2. Building TypeScript..." -ForegroundColor Yellow
    Push-Location $repoRoot
    try {
        $buildOut = npm run build 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   Build OK" -ForegroundColor Green
        } else {
            Write-Host "   Build failed:" -ForegroundColor Red
            $buildOut | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
            exit 1
        }
    } finally {
        Pop-Location
    }

    Write-Host "3. Creating runner script..." -ForegroundColor Yellow

    if (-not (Test-Path $userScriptsDir)) {
        New-Item -ItemType Directory -Path $userScriptsDir -Force | Out-Null
    }

    $escapedRoot = $repoRoot -replace '\\', '\\'
    $escapedLog = $logFile -replace '\\', '\\'

    $runnerContent = @"
# Start-CatsRuntime.ps1
# Auto-generated by Setup-AutoStart.ps1

`$repoRoot = "$escapedRoot"
`$logFile = "$escapedLog"

Set-Location `$repoRoot

`$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path `$logFile -Value ""
Add-Content -Path `$logFile -Value "=== [`$timestamp] Starting cats-runtime ==="

Start-Process -FilePath "node.exe" -ArgumentList "build/runtime/index.js" ``
    -WorkingDirectory `$repoRoot ``
    -WindowStyle Hidden ``
    -RedirectStandardOutput "`$logFile.out" ``
    -RedirectStandardError "`$logFile.err" ``
    -PassThru | ForEach-Object {
    Add-Content -Path `$logFile -Value "Started (PID: `$(`$_.Id))"
}

Add-Content -Path `$logFile -Value "=== Startup complete ==="
"@

    Set-Content -Path $runnerScript -Value $runnerContent -Encoding UTF8
    Write-Host "   Created: $runnerScript" -ForegroundColor Green

    Write-Host "4. Creating startup shortcut..." -ForegroundColor Yellow

    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($startupShortcut)
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerScript`""
    $Shortcut.WorkingDirectory = $repoRoot
    $Shortcut.WindowStyle = 7
    $Shortcut.Description = "Cats Runtime - embedded runtime service"
    $Shortcut.Save()

    Write-Host "   Created: $startupShortcut" -ForegroundColor Green

    Write-Host ""
    Write-Host "Setup complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Runtime:   http://localhost:$port" -ForegroundColor White
    Write-Host "  Setup:     if first launch enters bootstrap mode, open / to configure providers" -ForegroundColor Yellow
    Write-Host "  Runner:    $runnerScript" -ForegroundColor Gray
    Write-Host "  Log:       $logFile" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Start now (without reboot):" -ForegroundColor Cyan
    Write-Host "  powershell -File `"$runnerScript`"" -ForegroundColor White
    Write-Host ""
    exit 0
}

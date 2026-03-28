<#
.SYNOPSIS
    Restart cats-runtime service

.DESCRIPTION
    Stops any running cats-runtime process on the configured port, then restarts
    it in a hidden window.

    This script builds TypeScript before starting the runtime.

.PARAMETER Stop
    Only stop the service, do not restart

.PARAMETER Port
    Override port (default: from .env or 3110)

.PARAMETER NoRedirect
    Start the runtime without stdout/stderr redirection. Use this when launching
    from automation that must detach cleanly from the long-lived Node process.

.PARAMETER StartupTimeoutSec
    How long to wait for the runtime health endpoint before reporting startup
    failure. Default: 60 seconds.

.EXAMPLE
    .\Restart-Server.ps1
    Restart cats-runtime

.EXAMPLE
    .\Restart-Server.ps1 -Stop
    Stop without restarting

.EXAMPLE
    .\Restart-Server.ps1 -NoRedirect
    Restart cats-runtime without startup log redirection
#>

param(
    [switch]$Stop,
    [int]$Port = 0,
    [switch]$NoRedirect,
    [int]$StartupTimeoutSec = 60
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $repoRoot ".env"
$bindHost = "127.0.0.1"

if ($Port -eq 0) {
    $Port = 3110
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Select-String '^CATS_RUNTIME_PORT\s*='
        if ($line) {
            $p = ($line.Line -split '=', 2)[1].Trim()
            if ($p) { $Port = [int]$p }
        }
    }
}

if (Test-Path $envFile) {
    $hostLine = Get-Content $envFile | Select-String '^CATS_RUNTIME_HOST\s*='
    if ($hostLine) {
        $configuredHost = ($hostLine.Line -split '=', 2)[1].Trim()
        if ($configuredHost) { $bindHost = $configuredHost }
    }
}

function Get-LoopbackHealthHost($inputHost) {
    switch ($inputHost) {
        "0.0.0.0" { return "127.0.0.1" }
        "::" { return "127.0.0.1" }
        "[::]" { return "127.0.0.1" }
        default { return $inputHost }
    }
}

function Format-HttpHost($inputHost) {
    if ($inputHost -match ':') {
        return "[$inputHost]"
    }
    return $inputHost
}

function Stop-ServiceOnPort($port) {
    $owningPid = $null

    try {
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop |
            Where-Object { $_.State -eq 'Listen' } |
            Select-Object -First 1
        if ($conn) {
            $owningPid = [int]$conn.OwningProcess
        }
    } catch {
        $owningPid = $null
    }

    if (-not $owningPid) {
        $netstatMatch = netstat -ano -p tcp |
            Select-String -Pattern "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
            Select-Object -First 1
        if ($netstatMatch) {
            $owningPid = [int]$netstatMatch.Matches[0].Groups[1].Value
        }
    }

    if ($owningPid) {
        $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "  Stopping PID $($proc.Id) on port $port..." -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            Write-Host "  Stopped" -ForegroundColor Green
            return
        }
    }
    Write-Host "  Not running on port $port" -ForegroundColor Gray
}

function Invoke-StaleTempCleanup($repoRoot) {
    $entry = Join-Path $repoRoot "dist\\index.js"
    if (!(Test-Path $entry)) {
        Write-Host "  Skipping stale temp cleanup (dist/index.js not built yet)" -ForegroundColor DarkGray
        return
    }

    Write-Host "Cleaning stale cats-runtime temp directories..." -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        $null = & node $entry --cleanup-temp-dirs 1>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Stale temp cleanup completed" -ForegroundColor Green
        } else {
            Write-Host "  Stale temp cleanup skipped (exit $LASTEXITCODE)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Stale temp cleanup skipped: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
}

Write-Host "Stopping cats-runtime..." -ForegroundColor Cyan
Stop-ServiceOnPort $Port

if ($Stop) {
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

Invoke-StaleTempCleanup $repoRoot

Write-Host "Building TypeScript..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
    $buildOut = npm run build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Build OK" -ForegroundColor Green
    } else {
        Write-Host "  Build failed:" -ForegroundColor Red
        $buildOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host "Starting cats-runtime..." -ForegroundColor Cyan

$stdoutLog = $null
$stderrLog = $null

if ($NoRedirect) {
    Write-Host "  Launching without stdout/stderr redirection" -ForegroundColor DarkGray
    $process = Start-Process -FilePath "node.exe" -ArgumentList "dist/index.js" `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -PassThru
} else {
    $startupLogDir = Join-Path $env:TEMP "cats-runtime"
    if (!(Test-Path $startupLogDir)) {
        New-Item -ItemType Directory -Path $startupLogDir | Out-Null
    }
    $startupStamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdoutLog = Join-Path $startupLogDir "cats-runtime-$startupStamp.stdout.log"
    $stderrLog = Join-Path $startupLogDir "cats-runtime-$startupStamp.stderr.log"

    $process = Start-Process -FilePath "node.exe" -ArgumentList "dist/index.js" `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru
}

Write-Host "Waiting for health check..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

try {
    $headers = @{}
    if (Test-Path $envFile) {
        $keyLine = Get-Content $envFile | Select-String '^CATS_RUNTIME_API_KEY\s*='
        if ($keyLine) {
            $apiKey = ($keyLine.Line -split '=', 2)[1].Trim()
            if ($apiKey) { $headers["Authorization"] = "Bearer $apiKey" }
        }
    }

    $healthHost = Get-LoopbackHealthHost $bindHost
    $healthHostForUrl = Format-HttpHost $healthHost
    $runtimeBaseUrl = "http://${healthHostForUrl}:$Port"
    $healthUrl = "$runtimeBaseUrl/health"
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSec)
    $response = $null
    $health = $null
    $lastHealthError = $null

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest `
                -Uri $healthUrl `
                -TimeoutSec 5 `
                -UseBasicParsing `
                -Headers $headers `
                -ErrorAction Stop

            try {
                $health = $response.Content | ConvertFrom-Json
            } catch {
                $health = $null
            }

            if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
                break
            }
        } catch {
            $lastHealthError = $_
        }

        Start-Sleep -Seconds 1
    }

    if (-not $response -or ($response.StatusCode -ne 200 -and $response.StatusCode -ne 503)) {
        if ($lastHealthError) {
            throw $lastHealthError
        }
        throw "Timed out waiting for $healthUrl"
    }

    if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
        $status = if ($health -and $health.status) { $health.status } else { "unknown" }
        Write-Host "  Health endpoint responding ($status)" -ForegroundColor Green
        Write-Host "  Runtime:  $runtimeBaseUrl" -ForegroundColor White
        $bootstrapRequired = $false
        if ($health -and $health.startup -and $null -ne $health.startup.bootstrapRequired) {
            $bootstrapRequired = [bool]$health.startup.bootstrapRequired
        }
        if ($bootstrapRequired) {
            Write-Host "  Setup:    bootstrap mode active, open $runtimeBaseUrl/ to configure providers" -ForegroundColor Yellow
        }
        if ($health -and $health.backend) {
            $backendReachable = [bool]$health.backend.reachable
            $backendBaseUrl = [string]$health.backend.baseUrl
            if ($backendReachable) {
                Write-Host "  Backend:  reachable ($backendBaseUrl)" -ForegroundColor Green
            } else {
                Write-Host "  Backend:  unreachable ($backendBaseUrl)" -ForegroundColor Yellow
            }
        }
    }
} catch {
    Write-Host "  Not responding on port $Port" -ForegroundColor Red
    if ($_.Exception -and $_.Exception.Message) {
        Write-Host "  Last health error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    $process.Refresh()
    if ($process.HasExited) {
        Write-Host "  Process exited with code $($process.ExitCode)" -ForegroundColor Yellow
    } else {
        Write-Host "  Process is still running (PID $($process.Id))" -ForegroundColor Yellow
    }

    $stderrLines = @()
    if ($stderrLog -and (Test-Path $stderrLog)) {
        $stderrLines = Get-Content $stderrLog -ErrorAction SilentlyContinue | Select-Object -Last 20
    }
    $stdoutLines = @()
    if ($stdoutLog -and (Test-Path $stdoutLog)) {
        $stdoutLines = Get-Content $stdoutLog -ErrorAction SilentlyContinue | Select-Object -Last 20
    }

    if ($stderrLines.Count -gt 0) {
        Write-Host "  stderr tail:" -ForegroundColor Yellow
        $stderrLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    } elseif ($stdoutLines.Count -gt 0) {
        Write-Host "  stdout tail:" -ForegroundColor Yellow
        $stdoutLines | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }

    if ($stdoutLog -and $stderrLog) {
        Write-Host "  Logs: $stdoutLog" -ForegroundColor DarkGray
        Write-Host "        $stderrLog" -ForegroundColor DarkGray
    }
    Write-Host "  Check logs or run: npm run build; node dist/index.js" -ForegroundColor Yellow
    exit 1
}

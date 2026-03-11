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

.EXAMPLE
    .\Restart-Server.ps1
    Restart cats-runtime

.EXAMPLE
    .\Restart-Server.ps1 -Stop
    Stop without restarting
#>

param(
    [switch]$Stop,
    [int]$Port = 0
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $repoRoot ".env"

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

function Stop-ServiceOnPort($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' } |
        Select-Object -First 1
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
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

Write-Host "Stopping cats-runtime..." -ForegroundColor Cyan
Stop-ServiceOnPort $Port

if ($Stop) {
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

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

Start-Process -FilePath "node.exe" -ArgumentList "dist/index.js" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden

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

    $response = Invoke-WebRequest `
        -Uri "http://localhost:$Port/health" `
        -TimeoutSec 5 `
        -UseBasicParsing `
        -Headers $headers `
        -ErrorAction Stop

    $health = $null
    try {
        $health = $response.Content | ConvertFrom-Json
    } catch {
        $health = $null
    }

    if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 503) {
        $status = if ($health -and $health.status) { $health.status } else { "unknown" }
        Write-Host "  Health endpoint responding ($status)" -ForegroundColor Green
        Write-Host "  Runtime:  http://localhost:$Port" -ForegroundColor White
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
    Write-Host "  Check logs or run: npm run build; node dist/index.js" -ForegroundColor Yellow
}

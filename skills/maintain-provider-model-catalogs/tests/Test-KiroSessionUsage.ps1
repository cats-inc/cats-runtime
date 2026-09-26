<#
.SYNOPSIS
    Exercises Measure-KiroSessionUsage.ps1 against synthetic Kiro session files; reads no real session.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('kiro-usage-test-' + [Guid]::NewGuid().ToString('N'))
$subject = Join-Path $PSScriptRoot '../scripts/Measure-KiroSessionUsage.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$sessionId = '00000000-1111-2222-3333-444444444444'

function New-Metering([double[]]$Values) {
    @($Values | ForEach-Object { @{ value = $_; unit = 'credit'; unitPlural = 'credits' } })
}
$metadata = @{
    session_id = $sessionId
    session_state = @{ conversation_metadata = @{ user_turn_metadatas = @(
        @{ total_request_count = 4; turn_duration = @{ secs = 60; nanos = 5 }; model = 'example-model'
           input_token_count = 0; output_token_count = 0; cache_read_input_token_count = 0
           cache_write_input_token_count = 0; context_usage_percentage = 12.5
           end_timestamp = '2026-01-01T00:01:00Z'; metering_usage = (New-Metering 0.5, 0.25, 1, 2) }
        @{ total_request_count = 3; turn_duration = @{ secs = 30; nanos = 0 }; model = 'example-model'
           input_token_count = 10; output_token_count = 0; cache_read_input_token_count = 0
           cache_write_input_token_count = 0; context_usage_percentage = 20
           end_timestamp = '2026-01-01T00:02:00Z'; metering_usage = (New-Metering 1, 1) }
    ) } }
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $scratch "$sessionId.json") -Encoding UTF8
function Get-Line([string]$Kind, [string]$Text) {
    @{ version = 'v1'; kind = $Kind; data = @{ message_id = [Guid]::NewGuid().ToString(); content = @(@{ kind = 'text'; data = $Text }) } } |
        ConvertTo-Json -Depth 6 -Compress
}
@(
    (Get-Line 'Prompt' 'SECRET-PROMPT-TEXT first request')
    (Get-Line 'AssistantMessage' 'reading the skill')
    (Get-Line 'ToolResults' 'SECRET-TOOL-OUTPUT MARK-CAPTURE in a tool result')
    (Get-Line 'AssistantMessage' 'run MARK-CAPTURE now')
    (Get-Line 'AssistantMessage' 'still capturing')
    (Get-Line 'AssistantMessage' 'MARK-WRAP and report')
    (Get-Line 'Prompt' 'SECRET-PROMPT-TEXT second request')
    (Get-Line 'AssistantMessage' 'one')
    (Get-Line 'AssistantMessage' 'two')
    (Get-Line 'AssistantMessage' 'three')
    (Get-Line 'Prompt' 'SECRET-PROMPT-TEXT third request, still running')
    (Get-Line 'AssistantMessage' 'working')
) | Set-Content -LiteralPath (Join-Path $scratch "$sessionId.jsonl") -Encoding UTF8

function Invoke-Measure([hashtable]$Extra = @{}) {
    $params = @{ SessionId = $sessionId; SessionDirectory = $scratch }
    foreach ($key in $Extra.Keys) { $params[$key] = $Extra[$key] }
    & $subject @params
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Label) {
    $failed = $false
    try { $null = & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Label failed unexpectedly: $($_.Exception.Message)" }
        $failed = $true
    }
    if (-not $failed) { throw "$Label did not fail." }
}

try {
    $raw = Invoke-Measure @{ Turn = 1; PhaseBoundary = @('MARK-CAPTURE', 'MARK-WRAP'); PhaseName = @('Prep', 'Capture', 'Wrap') } |
        Out-String
    if ($raw -match 'SECRET|reading the skill') { throw 'Usage output contained transcript content.' }
    $usage = $raw | ConvertFrom-Json
    $turns = @($usage.Turns)
    if ($turns.Count -ne 3 -or $turns[0].Requests -ne 4 -or $turns[0].AssistantMessages -ne 4 -or
        $turns[0].MeteringEntries -ne 4 -or $turns[0].Credits -ne 3.75 -or $turns[0].TokensRecorded -or
        $turns[0].DurationSeconds -ne 60 -or $turns[0].ContextUsagePercent -ne 12.5 -or
        -not $turns[1].TokensRecorded -or $turns[1].Credits -ne 2 -or $turns[2].Recorded -or
        $turns[2].AssistantMessages -ne 1) {
        throw 'Per-turn requests, credits, token flags or the in-progress turn were incorrect.'
    }
    $phases = @($usage.Phases)
    if (($phases.Phase -join ',') -ne 'Prep,Capture,Wrap' -or ($phases.AssistantMessages -join ',') -ne '1,2,1' -or
        ($phases.Credits -join ',') -ne '0.5,1.25,2' -or $phases[1].FirstMessage -ne 2 -or $phases[1].LastMessage -ne 3) {
        throw 'Phase boundaries or phase credits were incorrect; tool results must not start a phase.'
    }
    if ($usage.RecordedTotals.Turns -ne 2 -or $usage.RecordedTotals.Requests -ne 7 -or $usage.RecordedTotals.Credits -ne 5.75) {
        throw 'Recorded totals were incorrect.'
    }
    Write-Output 'PASS per-turn credits, token flags, phases and totals without transcript content'

    $second = Invoke-Measure @{ Turn = 2 } | Out-String | ConvertFrom-Json
    if (@($second.Phases).Count -ne 1 -or $second.Phases[0].AssistantMessages -ne 3 -or $null -ne $second.Phases[0].Credits) {
        throw 'Phase credits were reported although metering entries and messages differ.'
    }
    $third = Invoke-Measure @{ Turn = 3 } | Out-String | ConvertFrom-Json
    if ($third.Phases[0].AssistantMessages -ne 1 -or $null -ne $third.Phases[0].Credits) {
        throw 'An in-progress turn reported credits.'
    }
    Write-Output 'PASS omits phase credits when metering is missing or does not pair with messages'

    Assert-Throws { Invoke-Measure @{ Turn = 1; PhaseBoundary = @('NOT-PRESENT') } } 'was not found' 'A missing boundary'
    Assert-Throws { Invoke-Measure @{ PhaseBoundary = @('MARK-CAPTURE') } } 'requires -Turn' 'A boundary without -Turn'
    Assert-Throws { Invoke-Measure @{ Turn = 1; PhaseBoundary = @('MARK-CAPTURE'); PhaseName = @('only') } } 'one more name' 'Mismatched phase names'
    Assert-Throws { Invoke-Measure @{ SessionId = '..\outside' } } 'unexpected characters' 'A path-like session id'
    Assert-Throws { Invoke-Measure @{ Turn = 9 } } 'no turn 9' 'A missing turn'
    Write-Output 'PASS rejects missing boundaries, unpaired names, path-like ids and missing turns'
} finally {
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'kiro-usage-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

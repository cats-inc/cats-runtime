<#
.SYNOPSIS
    Summarizes the requests, credits and context use of the Kiro CLI session hosting an agent.
.DESCRIPTION
    Reads <SessionDirectory>/<SessionId>.json (per-turn metadata) and .jsonl (transcript) written
    by Kiro CLI, and prints counts and numbers only, never message content. Kiro records a turn's
    metadata when the turn ends, so the turn still in progress has no metadata yet.

    Kiro 2.24.1 records one metering_usage credit entry per request but leaves the token fields at
    0. Tokens are therefore reported as not recorded when every token field is 0; credits are the
    available cost measure. Uncached input, cache writes, cache reads and output cannot be split.

    -Turn with -PhaseBoundary splits one turn into phases. Each boundary is a literal,
    case-sensitive string; the first assistant message after the previous boundary that contains
    the next string starts the next phase, so the message that contains it belongs to the new
    phase. Match a unique command or file name from the agent's own tool calls. Phase credits
    pair the turn's metering entries with its assistant messages in order and are omitted when
    the two counts differ.
.PARAMETER SessionId
    Kiro session id. Defaults to KIRO_SESSION_ID, which Kiro sets for its agent's commands.
.PARAMETER SessionDirectory
    Directory holding the session files. Defaults to ~/.kiro/sessions/cli.
.PARAMETER Turn
    1-based user turn to split into phases.
.PARAMETER PhaseBoundary
    Literal strings that start phases 2..N of the selected turn, in order.
.PARAMETER PhaseName
    Optional names for phases 1..N; the count must be one more than the boundaries.
.EXAMPLE
    & .\Measure-KiroSessionUsage.ps1 -Turn 1 -PhaseBoundary 'Action Launch', 'final-window' `
        -PhaseName 'Preparation', 'Capture', 'Wrap-up and questions'
#>
[CmdletBinding()]
param(
    [string]$SessionId = $env:KIRO_SESSION_ID,
    [string]$SessionDirectory = (Join-Path (Join-Path (Join-Path $HOME '.kiro') 'sessions') 'cli'),
    [ValidateRange(1,10000)][int]$Turn,
    [string[]]$PhaseBoundary = @(),
    [string[]]$PhaseName = @()
)
$ErrorActionPreference = 'Stop'
if (-not $SessionId) { throw 'Pass -SessionId, or run inside the Kiro session so KIRO_SESSION_ID is set.' }
if ($SessionId -notmatch '^[A-Za-z0-9-]+$') { throw 'The session id contains unexpected characters.' }
if ($PhaseBoundary.Count -and -not $Turn) { throw '-PhaseBoundary requires -Turn.' }
if ($PhaseName.Count -and $PhaseName.Count -ne $PhaseBoundary.Count + 1) {
    throw '-PhaseName needs exactly one more name than -PhaseBoundary.'
}
$SessionDirectory = (Resolve-Path -LiteralPath $SessionDirectory).ProviderPath
$metadataPath = Join-Path $SessionDirectory ($SessionId + '.json')
$transcriptPath = Join-Path $SessionDirectory ($SessionId + '.jsonl')
$session = Get-Content -Raw -LiteralPath $metadataPath -Encoding UTF8 | ConvertFrom-Json
$metadata = @($session.session_state.conversation_metadata.user_turn_metadatas)

# Assistant messages per turn, in order; a Prompt line starts the next turn.
$turnMessages = @()
foreach ($line in [IO.File]::ReadLines($transcriptPath)) {
    if (-not $line.Trim()) { continue }
    $kind = ($line | ConvertFrom-Json).kind
    if ($kind -eq 'Prompt') { $turnMessages += , (New-Object System.Collections.ArrayList) }
    elseif ($kind -eq 'AssistantMessage') {
        if ($turnMessages.Count -eq 0) { throw 'The transcript has an assistant message before any prompt.' }
        $null = $turnMessages[$turnMessages.Count - 1].Add($line)
    }
}

function Get-Credits($Entries) {
    $sum = 0.0
    foreach ($entry in @($Entries)) {
        if ($entry.unit -ne 'credit') { throw "Unexpected metering unit '$($entry.unit)'." }
        $sum += [double]$entry.value
    }
    return [Math]::Round($sum, 4)
}

$turns = @()
for ($i = 0; $i -lt [Math]::Max($turnMessages.Count, $metadata.Count); $i++) {
    $meta = if ($i -lt $metadata.Count) { $metadata[$i] } else { $null }
    $messages = if ($i -lt $turnMessages.Count) { $turnMessages[$i].Count } else { $null }
    if ($meta) {
        $tokens = [ordered]@{
            input = [long]$meta.input_token_count; output = [long]$meta.output_token_count
            cacheRead = [long]$meta.cache_read_input_token_count; cacheWrite = [long]$meta.cache_write_input_token_count
        }
        $metering = @($meta.metering_usage | Where-Object { $_ })
        $turns += [pscustomobject]@{
            Turn = $i + 1; Recorded = $true; Model = $meta.model
            Requests = [int]$meta.total_request_count; AssistantMessages = $messages
            MeteringEntries = $metering.Count; Credits = (Get-Credits $metering)
            DurationSeconds = [int]$meta.turn_duration.secs
            ContextUsagePercent = [double]$meta.context_usage_percentage
            TokensRecorded = (@($tokens.Values | Where-Object { $_ -ne 0 }).Count -gt 0)
            Tokens = [pscustomobject]$tokens; EndedAt = $meta.end_timestamp
        }
    } else {
        $turns += [pscustomobject]@{ Turn = $i + 1; Recorded = $false; AssistantMessages = $messages
            Note = 'No turn metadata yet; Kiro records it when the turn ends.' }
    }
}

$phases = @()
if ($Turn) {
    if ($Turn -gt $turnMessages.Count) { throw "The transcript has no turn $Turn." }
    $messages = $turnMessages[$Turn - 1]
    $meta = if ($Turn -le $metadata.Count) { $metadata[$Turn - 1] } else { $null }
    $metering = if ($meta) { @($meta.metering_usage | Where-Object { $_ }) } else { @() }
    $pairCredits = $meta -and $metering.Count -eq $messages.Count
    $starts = @(0)
    $next = 0
    for ($m = 0; $m -lt $messages.Count -and $next -lt $PhaseBoundary.Count; $m++) {
        if ($messages[$m].Contains($PhaseBoundary[$next])) { $starts += $m; $next++ }
    }
    if ($next -lt $PhaseBoundary.Count) { throw "Phase boundary '$($PhaseBoundary[$next])' was not found in turn $Turn." }
    for ($p = 0; $p -lt $starts.Count; $p++) {
        $from = $starts[$p]
        $to = if ($p + 1 -lt $starts.Count) { $starts[$p + 1] - 1 } else { $messages.Count - 1 }
        $phases += [pscustomobject]@{
            Phase = $(if ($PhaseName.Count) { $PhaseName[$p] } else { 'phase-' + ($p + 1) })
            FirstMessage = $from + 1; LastMessage = $to + 1; AssistantMessages = $to - $from + 1
            Credits = $(if ($pairCredits -and $to -ge $from) { Get-Credits $metering[$from..$to] } else { $null })
        }
    }
}

$recorded = @($turns | Where-Object Recorded)
[pscustomobject]@{
    SessionId = $SessionId
    Turns = $turns
    Phases = $phases
    RecordedTotals = [pscustomobject]@{
        Turns = $recorded.Count
        Requests = [int](($recorded | Measure-Object Requests -Sum).Sum)
        Credits = [Math]::Round([double](($recorded | Measure-Object Credits -Sum).Sum), 4)
    }
    Note = 'Counts and credits only. When TokensRecorded is false, Kiro did not record token usage.'
} | ConvertTo-Json -Depth 5

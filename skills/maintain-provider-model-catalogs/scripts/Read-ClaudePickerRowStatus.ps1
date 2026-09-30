<#
.SYNOPSIS
    Reads the model value that each chosen Claude Code /model picker row sets, from /status.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an empty Claude Code prompt in a
    dedicated Windows Terminal window. For each requested row it opens /model, highlights the
    row with Up/Down, presses "s" (use this session only), opens /status, reads its Version and
    Model lines, and closes /status with Escape. "alias (resolved id)" in the Model line means
    the row sets the alias; a bare id means the row sets that id.
    Enter is sent only to run the typed /model and /status commands, never inside the picker, so
    no row is saved as the default. The settings file must keep its SHA-256 after every row.
    The session model is left at the last row; exit the owned CLI with /exit afterwards.
    Does not launch or log in to Claude Code, send prompts, or edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER Rows
    Comma-separated picker row numbers, for example "2,4,6".
.PARAMETER OutputFile
    New JSON file for the results, outside tracked repository content. It must not exist.
.PARAMETER ConfigPath
    Settings file that the picker would write (normally ~/.claude/settings.json).
.EXAMPLE
    .\Read-ClaudePickerRowStatus.ps1 -UiHelperPath $uiHelper -WindowTitle 'Catalog capture' `
        -Rows '2,4,6' -OutputFile "$evidenceDir\row-status.json" `
        -ConfigPath "$env:USERPROFILE\.claude\settings.json"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][ValidatePattern('^\d+(,\d+)*$')][string]$Rows,
    [Parameter(Mandatory)][string]$OutputFile,
    [Parameter(Mandatory)][string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (Test-Path -LiteralPath $OutputFile) { throw 'Use a new output file; previous results must not be overwritten.' }
$baseline = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName WindowsTerminal
Assert-WindowsUiFocus $target

# Claude Code renders the prompt/highlight glyph U+276F followed by a no-break space.
$mark = [string][char]0x276F
$emptyPrompt = '(?m)^' + $mark + '\s*$'
$footer = 'Enter to set as default'
$statusModel = '(?m)^[ \t]*Model:[ \t]+(?<value>\S[^\r\n]*)'
$results = @()

function Assert-ConfigUnchanged([string]$When) {
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
        throw "Config changed $When. Stop; do not overwrite possible concurrent edits."
    }
}

function Invoke-SlashCommand([string]$Command, [string]$Opened) {
    $typed = '(?m)^' + $mark + '\s' + [regex]::Escape($Command) + '\s*$'
    Send-WindowsUiText $target -Text $Command -ExpectedText $emptyPrompt
    $null = Wait-WindowsUiText $target -ExpectedText $typed
    Send-WindowsUiKey $target -Key Enter -ExpectedText $typed
    return Wait-WindowsUiText $target -ExpectedText $Opened -TimeoutMilliseconds 8000
}

function Get-Highlight([string]$Text) {
    $start = $Text.LastIndexOf('Select model')
    if ($start -lt 0 -or $Text.IndexOf($footer, $start) -lt 0) { throw 'Claude model picker is not fully visible.' }
    $found = [regex]::Matches($Text.Substring($start), '(?m)^[ \t]*' + $mark + '\s(?<index>\d+)\.\s+(?<rest>[^\r\n]+)')
    if ($found.Count -ne 1) { throw 'Picker highlight is ambiguous.' }
    return $found[0]
}

try {
    if ((Get-WindowsUiText $target) -notmatch $emptyPrompt) { throw 'Start at an empty Claude Code prompt.' }
    foreach ($row in @($Rows -split ',' | ForEach-Object { [int]$_ })) {
        $null = Invoke-SlashCommand '/model' $footer
        for ($step = 0; $step -lt 60; $step++) {
            $at = [int](Get-Highlight (Get-WindowsUiText $target)).Groups['index'].Value
            if ($at -eq $row) { break }
            $next = if ($row -gt $at) { $at + 1 } else { $at - 1 }
            $key = if ($row -gt $at) { 'Down' } else { 'Up' }
            Send-WindowsUiKey $target -Key $key -ExpectedText ('(?m)^[ \t]*' + $mark + '\s' + $at + '\.\s')
            $null = Wait-WindowsUiText $target -ExpectedText ('(?m)^[ \t]*' + $mark + '\s' + $next + '\.\s')
        }
        # Wait for a complete redraw (highlight and footer together) before the one "s" key.
        $ready = '(?s)(?m)^[ \t]*' + $mark + '\s' + $row + '\.\s.*' + $footer
        $screen = Wait-WindowsUiText $target -ExpectedText $ready
        $highlight = Get-Highlight $screen
        if ([int]$highlight.Groups['index'].Value -ne $row) { throw "Row $row is not highlighted." }
        $label = ($highlight.Groups['rest'].Value.Trim() -split '[ \t]{2,}', 2)[0].TrimEnd([char]0x2714).Trim()
        Send-WindowsUiText $target -Text 's' -ExpectedText $ready
        $after = Wait-WindowsUiText $target -ExpectedText $emptyPrompt -TimeoutMilliseconds 8000
        if ($after -match $footer) { throw "The picker stayed open after s on row $row." }
        $confirmation = @([regex]::Matches($after, '(?m)(?<line>Set model to [^\r\n]+?)\s*$') |
            ForEach-Object { $_.Groups['line'].Value })
        Assert-ConfigUnchanged "after s on row $row"
        $status = Invoke-SlashCommand '/status' $statusModel
        $version = [regex]::Match($status, '(?m)^[ \t]*Version:[ \t]+(?<value>\S+)').Groups['value'].Value
        $model = [regex]::Match($status, $statusModel).Groups['value'].Value.Trim()
        Send-WindowsUiKey $target -Key Escape -ExpectedText $statusModel
        $null = Wait-WindowsUiText $target -ExpectedText $emptyPrompt
        Assert-ConfigUnchanged "after /status on row $row"
        $results += [pscustomobject]@{
            Row = $row; Label = $label
            Confirmation = $(if ($confirmation.Count -gt 0) { $confirmation[-1] } else { $null })
            Version = $version; StatusModel = $model
        }
    }
} finally {
    if ($results.Count -gt 0) {
        ConvertTo-Json -InputObject @($results) -Depth 4 | Set-Content -LiteralPath $OutputFile -Encoding UTF8
    }
}
Assert-ConfigUnchanged 'at the end'
[pscustomobject]@{
    Rows = $results; ConfigUnchanged = $true
    Scope = 'visible /status Model line after choosing each row for this session only'
} | ConvertTo-Json -Depth 4

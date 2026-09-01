<#
.SYNOPSIS
    Remove local branches whose upstream was deleted after a squash merge.

.DESCRIPTION
    Intended as the opening step of an agent session in a repository that is
    shared by several agents working from one clone.

    The project merges with `gh pr merge --auto --squash` and lets GitHub delete
    the head branch. A squashed commit has a different SHA than the branch it
    came from, so `git branch -d` always reports "not fully merged" and refuses.
    This script therefore uses upstream state, not commit reachability: a branch
    counts as merged when it had an upstream and that upstream is gone, which
    for this project only happens after the pull request landed.

    A branch that was never pushed has no upstream at all and can never be
    reported as gone, so local-only experiments are never swept. Branches that
    are checked out in another worktree are reported and skipped rather than
    left to fail.

    The working tree must be clean. In a shared clone a dirty tree usually means
    another agent left work behind, so the script stops instead of guessing.

.PARAMETER ReturnToDefault
    Switch to the default branch and fast-forward it after sweeping. The switch
    happens regardless when the current branch is one of the deleted ones,
    because a checked-out branch cannot be removed.

.PARAMETER SkipFetch
    Skip `git fetch --prune`. Only useful when a fetch just ran, since without a
    prune the deleted upstreams are not yet visible as gone.

.PARAMETER RepositoryRoot
    Override the repository to operate on. Intended for isolated validation.

.EXAMPLE
    .\Remove-MergedBranches.ps1 -WhatIf
    Show which branches would be removed without changing anything.

.EXAMPLE
    .\Remove-MergedBranches.ps1 -ReturnToDefault
    Sweep merged branches, then land on an up-to-date default branch.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $false)]
    [switch]$ReturnToDefault,

    [Parameter(Mandatory = $false)]
    [switch]$SkipFetch,

    [Parameter(Mandatory = $false)]
    [string]$RepositoryRoot
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param([string[]]$Arguments, [switch]$AllowFailure)

    $output = & git -C $script:RepoRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE`n$output"
    }
    return $output
}

# Resolve the repository first so every later call is explicitly scoped to it.
$startDir = if ($RepositoryRoot) { $RepositoryRoot } else { (Get-Location).Path }
$script:RepoRoot = & git -C $startDir rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $script:RepoRoot) {
    throw "Not a git repository: $startDir"
}
$script:RepoRoot = $script:RepoRoot.Trim()

# A dirty tree in a shared clone is somebody else's unfinished work.
$dirty = Invoke-Git @("status", "--porcelain")
if ($dirty) {
    $count = @($dirty).Count
    throw "Working tree is not clean ($count entries). Resolve or stash that work before sweeping branches."
}

# Stale worktree registrations keep their branches undeletable, so clear them
# before deciding what can go.
Invoke-Git @("worktree", "prune") | Out-Null

if (-not $SkipFetch) {
    Invoke-Git @("fetch", "--prune") | Out-Null
}

# origin/HEAD is the recorded default branch; refresh it if the clone lacks one.
$defaultRef = Invoke-Git @("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD") -AllowFailure
if ($LASTEXITCODE -ne 0 -or -not $defaultRef) {
    Invoke-Git @("remote", "set-head", "origin", "--auto") -AllowFailure | Out-Null
    $defaultRef = Invoke-Git @("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD") -AllowFailure
}
$defaultBranch = if ($defaultRef) {
    ($defaultRef | Select-Object -First 1).ToString().Trim() -replace '^refs/remotes/origin/', ''
} else {
    "main"
}

$currentBranch = (Invoke-Git @("branch", "--show-current") | Select-Object -First 1)
if ($currentBranch) { $currentBranch = $currentBranch.ToString().Trim() }

# Branches held by another worktree cannot be deleted; git blocks it for us, but
# reporting them is more useful than surfacing a raw error.
$worktreeBranches = @{}
foreach ($line in @(Invoke-Git @("worktree", "list", "--porcelain"))) {
    $text = $line.ToString()
    if ($text -match '^branch\s+refs/heads/(.+)$') {
        $name = $Matches[1]
        if ($name -ne $currentBranch) { $worktreeBranches[$name] = $true }
    }
}

$gone = @()
foreach ($line in @(Invoke-Git @("for-each-ref", "--format=%(refname:short)%09%(upstream:track,nobracket)", "refs/heads"))) {
    $parts = $line.ToString().Split("`t")
    if ($parts.Count -ge 2 -and $parts[1].Trim() -eq "gone") {
        $gone += $parts[0].Trim()
    }
}

# The default branch tracks a live upstream and should never reach this list,
# but never delete the branch everything else falls back to.
$gone = @($gone | Where-Object { $_ -ne $defaultBranch })

$blocked = @($gone | Where-Object { $worktreeBranches.ContainsKey($_) })
$deletable = @($gone | Where-Object { -not $worktreeBranches.ContainsKey($_) })

foreach ($name in $blocked) {
    Write-Host "  skip   $name (checked out in another worktree)"
}

if ($deletable.Count -eq 0) {
    Write-Host "No merged branches to remove."
} else {
    # A checked-out branch cannot be deleted, so step off it first.
    if ($currentBranch -and $deletable -contains $currentBranch) {
        if ($PSCmdlet.ShouldProcess($defaultBranch, "Switch away from '$currentBranch' before deleting it")) {
            Invoke-Git @("switch", $defaultBranch) | Out-Null
            Write-Host "  switch $defaultBranch (left '$currentBranch' so it can be removed)"
            $currentBranch = $defaultBranch
        } elseif (-not $WhatIfPreference) {
            # Declined under -Confirm: the branch cannot be deleted while it is
            # still checked out, so drop it. -WhatIf also lands here because
            # ShouldProcess reports false, but there the intent is a preview, so
            # keep the branch listed and let the delete below be previewed too.
            $deletable = @($deletable | Where-Object { $_ -ne $currentBranch })
        }
    }

    foreach ($name in $deletable) {
        # -D, not -d: a squashed branch is never reachable from the default
        # branch, so -d refuses every time. `gone` is the merge evidence here.
        if ($PSCmdlet.ShouldProcess($name, "Delete merged local branch")) {
            $sha = (Invoke-Git @("rev-parse", "--short", $name) | Select-Object -First 1).ToString().Trim()
            Invoke-Git @("branch", "-D", $name) | Out-Null
            Write-Host "  delete $name (was $sha)"
        }
    }
}

if ($ReturnToDefault -and $currentBranch -ne $defaultBranch) {
    if ($PSCmdlet.ShouldProcess($defaultBranch, "Switch and fast-forward")) {
        Invoke-Git @("switch", $defaultBranch) | Out-Null
        Invoke-Git @("pull", "--ff-only") -AllowFailure | Out-Null
        Write-Host "  switch $defaultBranch (fast-forwarded)"
    }
} elseif ($ReturnToDefault) {
    if ($PSCmdlet.ShouldProcess($defaultBranch, "Fast-forward")) {
        Invoke-Git @("pull", "--ff-only") -AllowFailure | Out-Null
        Write-Host "  pull   $defaultBranch (fast-forwarded)"
    }
}

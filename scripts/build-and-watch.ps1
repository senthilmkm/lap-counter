# build-and-watch.ps1
# Pushes current changes, triggers the GitHub Actions iOS build, polls until
# finished, and dumps the failed logs so the next fix can be applied quickly.
#
# Usage:  pwsh scripts/build-and-watch.ps1

$REPO   = "senthilmkm/lap-counter"
$WF     = "build-ios.yml"
$BRANCH = "main"

function Log($msg)  { Write-Host "  $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "WRN $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "ERR $msg" -ForegroundColor Red }
function Sep()      { Write-Host ("-" * 70) -ForegroundColor DarkGray }

Sep
Write-Host "iOS Build Auto-Trigger and Monitor" -ForegroundColor White
Sep

# 1. Push any uncommitted or unpushed changes
$dirty = git status --porcelain 2>&1
if ($dirty) {
    Warn "Working tree dirty - staging and committing..."
    git add -A
    $ts = Get-Date -Format "HH:mm:ss"
    git commit -m "chore: auto-commit by build-and-watch.ps1 [$ts]"
}

$unpushed = git log origin/main..HEAD --oneline 2>&1
if ($unpushed) {
    Log "Pushing to origin/main..."
    git push origin main
    if ($LASTEXITCODE -ne 0) { Err "git push failed"; exit 1 }
    Ok "Pushed to origin/main"
} else {
    Log "Already up to date with origin/main"
}

Sep

# 2. Trigger the workflow dispatch
Log "Triggering workflow '$WF' on branch '$BRANCH'..."
gh workflow run $WF --repo $REPO --ref $BRANCH
if ($LASTEXITCODE -ne 0) { Err "Failed to trigger workflow"; exit 1 }

# Wait for GitHub to register the new run
Start-Sleep -Seconds 8

# 3. Get the run ID of the newly triggered run
Log "Finding new workflow run..."
$runId = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 3
    $json = gh run list --repo $REPO --workflow $WF --branch $BRANCH --limit 1 --json databaseId,status,createdAt 2>&1
    try {
        $runs = $json | ConvertFrom-Json
        if ($runs.Count -gt 0) {
            $runId = $runs[0].databaseId
            break
        }
    } catch {}
}

if (-not $runId) { Err "Could not find run ID after 20 attempts"; exit 1 }
Ok "Run ID: $runId"
Log "Live view: https://github.com/$REPO/actions/runs/$runId"
Sep

# 4. Poll until the run finishes
Write-Host "Polling build status every 30s..." -ForegroundColor White
$conclusion  = $null
$pollStart   = Get-Date
$dotCount    = 0

while (-not $conclusion) {
    Start-Sleep -Seconds 30
    $elapsed = [int]((Get-Date) - $pollStart).TotalMinutes
    $dotCount++

    $json = gh run view $runId --repo $REPO --json status,conclusion 2>&1
    try {
        $run = $json | ConvertFrom-Json
        $st  = $run.status
        if ($run.conclusion) { $conclusion = $run.conclusion }
        Write-Host ("`r  " + ("." * ($dotCount % 40)) + "  status=$st elapsed=${elapsed}m   ") -NoNewline
    } catch {
        Write-Host "`r  (polling...)   " -NoNewline
    }
}

Write-Host ""
Sep

# 5. Report result
$totalMin = [int]((Get-Date) - $pollStart).TotalMinutes

if ($conclusion -eq "success") {
    Ok "BUILD SUCCEEDED in ~${totalMin} minutes!"
    Ok "IPA submitted to App Store Connect."
} else {
    Err "BUILD FAILED (conclusion=$conclusion) after ~${totalMin} minutes"
    Sep
    Write-Host "Fetching failed step logs (last 200 lines)..." -ForegroundColor Yellow
    $logOut = gh run view $runId --repo $REPO --log-failed 2>&1
    if ($logOut) {
        $lines = ($logOut -split "`n")
        ($lines | Select-Object -Last 200) | ForEach-Object { Write-Host "  $_" }
    } else {
        Warn "Could not fetch logs. Visit:"
        Log "https://github.com/$REPO/actions/runs/$runId"
    }
}

Sep
Log "Run URL: https://github.com/$REPO/actions/runs/$runId"
Sep

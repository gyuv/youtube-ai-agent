# Lumen Flow launcher for Windows: one double-click (or `powershell -ExecutionPolicy Bypass -File start-lumen.ps1`)
# starts everything the Kidz Ulagam Google Flow clips need, and keeps it running:
#
#   - asks for your studio address and FLOW_WORKER_SECRET once, then remembers them (your Windows user only);
#   - downloads the latest Lumen Flow worker from GitHub each time you start it;
#   - starts flow-mcp (npm run studio) in its own window if it isn't running;
#   - keeps the PC awake while it runs (the screen may still turn off);
#   - restarts the worker if it ever stops or crashes.
#
# Close this window (or press Ctrl+C) to stop. Run it again to start.

# npm and node write warnings to stderr; in Windows PowerShell 5 "Stop" would turn those into crashes.
$ErrorActionPreference = "Continue"
$Log = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "start-lumen.log"
try { Start-Transcript -Path $Log -Append | Out-Null } catch {}
# Never close silently: show what went wrong and wait, so the window can be read.
trap {
  Write-Host "`nSomething went wrong: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Details are in $Log. Send that file (or this text) to get it fixed." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Worker = Join-Path $Here "flow-worker.mjs"
$WorkerUrl = "https://raw.githubusercontent.com/gyuv/youtube-ai-agent/claude/epic-cannon-4u9o4s/cloud/flow/flow-worker.mjs"
$FlowMcp = Join-Path $HOME "flow-mcp"

function Say($text, $color = "Cyan") { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $text" -ForegroundColor $color }

if ($args -contains "-Reset") {
  foreach ($n in "LUMEN_URL", "FLOW_WORKER_SECRET", "FLOW_DAILY_CREDITS") { [Environment]::SetEnvironmentVariable($n, $null, "User") }
  Say "Saved settings cleared; run the launcher again to enter new ones." "Yellow"
  exit
}

# 1. Settings, asked once and remembered for this Windows user.
function Setting($name, $prompt, $default = "", $pattern = ".", [switch]$Quiet) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  # Settings with a known default never ask: the default is used and remembered.
  if ($Quiet -and (-not $value -or "$value".Trim() -notmatch $pattern)) { $value = $default; [Environment]::SetEnvironmentVariable($name, $value, "User") }
  # A saved value that doesn't look right (e.g. a pasted command) is asked for again.
  if ($value -and "$value".Trim() -notmatch $pattern) {
    Write-Host "The saved $name doesn't look right ('$value'); please enter it again." -ForegroundColor Yellow
    $value = $null
  }
  if (-not $value) {
    while (-not $value) {
      $value = Read-Host "$prompt$(if ($default) { " [$default]" })"
      if (-not $value) { $value = $default }
      if (-not $value) { Write-Host "This one is needed." -ForegroundColor Yellow }
      elseif ("$value".Trim().Trim('"') -notmatch $pattern) {
        Write-Host "'$value' doesn't look right. Press Enter to use the value in [brackets], or type it again." -ForegroundColor Yellow
        $value = $null
      }
    }
    $value = "$value".Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name, $value, "User")
  }
  Set-Item -Path "Env:$name" -Value "$value".Trim()
}
Setting "LUMEN_URL" "Your studio address" "https://youtube-ai-agent-cloud.vercel.app" '^https?://\S+$' -Quiet
Setting "FLOW_WORKER_SECRET" "FLOW_WORKER_SECRET (the same value as in Vercel)" "" '^\S{32,}$'
Setting "FLOW_DAILY_CREDITS" "Google Flow credits you can spend per day" "1000" '^\d+$' -Quiet
Say "Settings loaded (to change them later: run with -Reset)."

# 2. Node.js must be installed.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say "Node.js isn't installed. Install the LTS version from https://nodejs.org, then run this again." "Red"
  Read-Host "Press Enter to close"; exit 1
}

# 3. Keep the PC awake while this window is open.
try {
  Add-Type -Namespace Lumen -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);' -ErrorAction Stop
  [Lumen.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  Say "The PC will stay awake while this window is open."
} catch {
  Say "Couldn't keep the PC awake automatically; set Sleep to Never in Windows power settings." "Yellow"
}

# 4. flow-mcp: install once if missing, then make sure its studio is running.
function FlowMcpUp {
  try { (Invoke-RestMethod "http://127.0.0.1:8787/api/health" -TimeoutSec 3 -ErrorAction Stop).name -eq "flow-mcp" } catch { $false }
}
if (-not (Test-Path (Join-Path $FlowMcp "package.json"))) {
  Say "Installing flow-mcp (first run only)..."
  $zip = Join-Path $HOME "flow-mcp.zip"
  Invoke-WebRequest "https://github.com/GTAI-1/flow-mcp/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop
  Expand-Archive $zip -DestinationPath $HOME -Force
  if (Test-Path (Join-Path $HOME "flow-mcp-main")) { Move-Item (Join-Path $HOME "flow-mcp-main") $FlowMcp -Force }
  Push-Location $FlowMcp; npm install; npm run build
  Say "Sign in to Google in the Chrome window that opens, open https://labs.google/flow once, then close it." "Yellow"
  npm run login; Pop-Location
}
function StartFlowMcp {
  if (FlowMcpUp) { return }
  Say "Starting flow-mcp in its own window..."
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$FlowMcp'; npm run studio" | Out-Null
  for ($i = 0; $i -lt 30 -and -not (FlowMcpUp); $i++) { Start-Sleep 2 }
  if (FlowMcpUp) { Say "flow-mcp is running. Keep a Flow project open in its Chrome window." "Green" }
  else { Say "flow-mcp didn't answer yet; the worker will keep checking." "Yellow" }
}
StartFlowMcp

# 5. Run the worker, always the latest version, and bring it back if it stops.
$restarts = 0
while ($true) {
  try {
    Invoke-WebRequest $WorkerUrl -OutFile "$Worker.new" -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
    if ((Get-Content "$Worker.new" -Raw) -match "Lumen") { Move-Item "$Worker.new" $Worker -Force; Say "Worker is up to date." }
  } catch {
    Say "Couldn't download the latest worker ($($_.Exception.Message)); using the copy on disk." "Yellow"
  }
  if (-not (Test-Path $Worker)) { Say "No worker file yet; retrying in 60s." "Red"; Start-Sleep 60; continue }

  StartFlowMcp
  Say "Starting the Lumen Flow worker..." "Green"
  node $Worker
  $restarts++
  $wait = [Math]::Min(300, 15 * $restarts)
  Say "The worker stopped (exit code $LASTEXITCODE). Restarting in $wait s... (close this window to stop)" "Yellow"
  Start-Sleep $wait
}

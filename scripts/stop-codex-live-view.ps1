$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "codex-live-view.pid"
$appServerPidFile = Join-Path $logsDir "codex-live-view-app-server.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "Codex Live View is not running."
  exit 0
}

$pidValue = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pidValue) {
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
  Write-Output "Codex Live View pid file was empty."
  exit 0
}

$process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $process.Id -Force
  Write-Output "Stopped Codex Live View process $($process.Id)."
} else {
  Write-Output "Codex Live View process was already gone."
}

Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue

if (Test-Path $appServerPidFile) {
  $appServerPid = Get-Content -Path $appServerPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($appServerPid) {
    $appServerProcess = Get-Process -Id ([int]$appServerPid) -ErrorAction SilentlyContinue
    if ($appServerProcess) {
      Stop-Process -Id $appServerProcess.Id -Force
      Write-Output "Stopped Codex Live View app-server process $($appServerProcess.Id)."
    }
  }

  Remove-Item -Path $appServerPidFile -Force -ErrorAction SilentlyContinue
}

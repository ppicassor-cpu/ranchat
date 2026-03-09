$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "codex-live-view-remote.pid"
$childPidFile = Join-Path $logsDir "codex-live-view-remote.child.pid"

if (-not (Test-Path $pidFile)) {
  Write-Output "Remote Codex Live View is not running."
  exit 0
}

$pidValue = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pidValue) {
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
  Write-Output "Remote Codex Live View pid file was empty."
  exit 0
}

$process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $process.Id -Force
  Write-Output "Stopped Remote Codex Live View process $($process.Id)."
} else {
  Write-Output "Remote Codex Live View process was already gone."
}

Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue

if (Test-Path $childPidFile) {
  $childPidValue = Get-Content -Path $childPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($childPidValue) {
    $childProcess = Get-Process -Id ([int]$childPidValue) -ErrorAction SilentlyContinue
    if ($childProcess) {
      Stop-Process -Id $childProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }

  Remove-Item -Path $childPidFile -Force -ErrorAction SilentlyContinue
}

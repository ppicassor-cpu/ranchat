param(
  [int]$Port = 8765,
  [string]$Token = "",
  [string]$CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logsDir = Join-Path $repoRoot "logs"
$traceFile = Join-Path $logsDir "codex-live-view-remote.trace.log"
$pidFile = Join-Path $logsDir "codex-live-view-remote.pid"
$stdoutLog = Join-Path $logsDir "codex-live-view-remote.stdout.log"
$stderrLog = Join-Path $logsDir "codex-live-view-remote.stderr.log"
$supervisorStdoutLog = Join-Path $logsDir "codex-live-view-remote-supervisor.stdout.log"
$supervisorStderrLog = Join-Path $logsDir "codex-live-view-remote-supervisor.stderr.log"
$urlFile = Join-Path $logsDir "codex-live-view-remote.url"
$urlBaseFile = Join-Path $logsDir "codex-live-view-remote.url-base"
$tokenFile = Join-Path $logsDir "codex-live-view-remote.token"
$childPidFile = Join-Path $logsDir "codex-live-view-remote.child.pid"
$statusFile = Join-Path $logsDir "codex-live-view-remote.status.json"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Write-TraceLine {
  param([string]$Message)
  Add-Content -Path $traceFile -Value ("{0} {1}" -f (Get-Date -Format "s"), $Message)
}

Remove-Item -Path $traceFile -Force -ErrorAction SilentlyContinue
Write-TraceLine "remote start script begin"

if (-not $CloudflaredPath) {
  $CloudflaredPath = Join-Path $logsDir "cloudflared.exe"
}

if (-not (Test-Path $CloudflaredPath)) {
  Write-TraceLine "downloading cloudflared"
  Invoke-WebRequest `
    -UseBasicParsing `
    -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
    -OutFile $CloudflaredPath
  Write-TraceLine "cloudflared downloaded"
}

Write-TraceLine "access mode prepared"

& (Join-Path $PSScriptRoot "stop-codex-live-view-remote.ps1") | Out-Null
Write-TraceLine "remote stop script completed"
& (Join-Path $PSScriptRoot "stop-codex-live-view.ps1") | Out-Null
Write-TraceLine "local stop script completed"
& (Join-Path $PSScriptRoot "start-codex-live-view.ps1") -Port $Port -Token $Token | Out-Null
Write-TraceLine "local start script completed"

Remove-Item -Path $stdoutLog, $stderrLog, $supervisorStdoutLog, $supervisorStderrLog, $urlFile, $urlBaseFile, $childPidFile, $statusFile -Force -ErrorAction SilentlyContinue

$node = (Get-Command node -ErrorAction Stop).Source
$supervisorScript = Join-Path $PSScriptRoot "codex-live-view-remote-supervisor.js"
Write-TraceLine "node resolved"
$argumentList = @(
  "`"$supervisorScript`"",
  "--port", "$Port",
  "--executable", "`"$CloudflaredPath`"",
  "--stdout-log", "`"$stdoutLog`"",
  "--stderr-log", "`"$stderrLog`"",
  "--url-base-file", "`"$urlBaseFile`"",
  "--child-pid-file", "`"$childPidFile`"",
  "--status-file", "`"$statusFile`""
)
Write-TraceLine "supervisor argument list prepared"

$process = Start-Process `
  -FilePath $node `
  -ArgumentList $argumentList `
  -WindowStyle Hidden `
  -RedirectStandardOutput $supervisorStdoutLog `
  -RedirectStandardError $supervisorStderrLog `
  -PassThru
Write-TraceLine "supervisor process started"

Set-Content -Path $pidFile -Value $process.Id
Set-Content -Path $tokenFile -Value $Token
Write-TraceLine "pid and state files written"

$publicBaseUrl = $null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 500

  if (Test-Path $urlBaseFile) {
    $publicBaseUrl = Get-Content -Path $urlBaseFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($publicBaseUrl) {
      Write-TraceLine "url base file detected"
      break
    }
  }

  if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    break
  }
}

if (-not $publicBaseUrl) {
  Write-TraceLine "public url not detected"
  Write-Host "The remote tunnel process started, but no public URL was detected yet."
  Write-Host "Check logs/codex-live-view-remote.stdout.log, logs/codex-live-view-remote.stderr.log, and logs/codex-live-view-remote-supervisor.stderr.log."
  exit 1
}

$separator = if ($publicBaseUrl.Contains("?")) { "&" } else { "?" }
$publicUrl = "$publicBaseUrl${separator}token=$Token"
if (-not $Token) {
  $publicUrl = $publicBaseUrl
}
Set-Content -Path $urlFile -Value $publicUrl
Write-TraceLine "public url written"

Write-Host ""
Write-Host "Remote Codex Live View is running."
Write-Host ""
Write-Host "Open this URL from your iPhone anywhere:"
Write-Host "  $publicUrl"
Write-Host ""
Write-Host "The URL is also saved in logs/codex-live-view-remote.url"
Write-Host "Anyone with this full URL can see the session until you stop the tunnel."
Write-Host "Stop it with:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\stop-codex-live-view-remote.ps1"

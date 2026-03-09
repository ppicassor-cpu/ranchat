param(
  [int]$Port = 8765,
  [string]$CodexHome = (Join-Path $env:USERPROFILE ".codex"),
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$node = (Get-Command node -ErrorAction Stop).Source
$serverScript = Join-Path $PSScriptRoot "codex-live-view-server.js"
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "codex-live-view.pid"
$stdoutLog = Join-Path $logsDir "codex-live-view.stdout.log"
$stderrLog = Join-Path $logsDir "codex-live-view.stderr.log"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (Test-Path $pidFile) {
  $existingPid = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingPid) {
    $existingProcess = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
    if ($existingProcess) {
      Write-Output "Codex Live View is already running with PID $existingPid"
    } else {
      Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not (Test-Path $pidFile)) {
  $argumentList = @(
    "`"$serverScript`"",
    "--port", "$Port",
    "--codex-home", "`"$CodexHome`""
  )
  if ($Token) {
    $argumentList += @("--token", "$Token")
  }

  $process = Start-Process `
    -FilePath $node `
    -ArgumentList $argumentList `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Set-Content -Path $pidFile -Value $process.Id
}

$healthUrl = "http://127.0.0.1:$Port/health"
$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  try {
    $result = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    if ($result.StatusCode -eq 200 -and $result.Content -eq "ok") {
      $healthy = $true
      break
    }
  } catch {}

  Start-Sleep -Milliseconds 300
}

$addresses = New-Object System.Collections.Generic.List[string]
$addresses.Add("127.0.0.1")

try {
  $ipCandidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -notlike "169.254.*" -and
      $_.IPAddress -ne "127.0.0.1" -and
      $_.PrefixOrigin -ne "WellKnown" -and
      $_.AddressState -eq "Preferred" -and
      $_.InterfaceAlias -notmatch "Wintun|Tailscale|Loopback|vEthernet|Hyper-V|WSL|VirtualBox|VMware"
    } |
    Sort-Object InterfaceMetric, SkipAsSource

  foreach ($candidate in $ipCandidates) {
    if (-not $addresses.Contains($candidate.IPAddress)) {
      $addresses.Add($candidate.IPAddress)
    }
  }
} catch {
  foreach ($ip in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) {
    if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
      continue
    }

    $text = $ip.IPAddressToString
    if ($text -eq "127.0.0.1" -or $text -like "169.254.*") {
      continue
    }

    if (-not $addresses.Contains($text)) {
      $addresses.Add($text)
    }
  }
}

if ($healthy) {
  Write-Output ""
  Write-Output "Codex Live View is running."
} else {
  Write-Output ""
  Write-Output "Codex Live View process started, but the local health check did not succeed yet."
  Write-Output "Check logs/codex-live-view.stderr.log if the page does not load."
}

Write-Output ""
Write-Output "Open one of these URLs on your iPhone:"
foreach ($address in $addresses) {
  if ($Token) {
    Write-Output ("  http://{0}:{1}/?token={2}" -f $address, $Port, $Token)
  } else {
    Write-Output ("  http://{0}:{1}/" -f $address, $Port)
  }
}

Write-Output ""
Write-Output "If the iPhone cannot connect, allow inbound traffic for Node or TCP port $Port in Windows Firewall."

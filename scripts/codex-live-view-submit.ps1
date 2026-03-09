param(
  [Parameter(Mandatory = $true)]
  [string]$ThreadId,
  [int]$AppServerPort = 8766,
  [ValidateSet("read-only", "workspace-write", "danger-full-access")]
  [string]$SandboxMode = "danger-full-access",
  [ValidateSet("never", "on-request", "on-failure", "untrusted")]
  [string]$ApprovalPolicy = "never",
  [string]$AttachmentsManifestPath = "",
  [switch]$DisallowSteer
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot "logs"
$pidFile = Join-Path $logsDir "codex-live-view-app-server.pid"
$stdoutLog = Join-Path $logsDir "codex-live-view-app-server.stdout.log"
$stderrLog = Join-Path $logsDir "codex-live-view-app-server.stderr.log"
$wsUrl = "ws://127.0.0.1:$AppServerPort"
$promptText = [Console]::In.ReadToEnd()
$threadSandboxMode = $SandboxMode
$approvalPolicy = $ApprovalPolicy

if ([string]::IsNullOrWhiteSpace($promptText)) {
  throw "Prompt text was empty."
}

$promptText = $promptText.Trim()
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Wait-AppServerPort {
  param([int]$Port)

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalPort -eq $Port } |
      Select-Object -First 1

    if ($listener) {
      return $true
    }

    Start-Sleep -Milliseconds 250
  }

  return $false
}

function Get-TurnSandboxPolicy {
  param(
    [ValidateSet("read-only", "workspace-write", "danger-full-access")]
    [string]$Mode
  )

  switch ($Mode) {
    "read-only" {
      return @{
        type = "readOnly"
      }
    }
    "workspace-write" {
      return @{
        type = "workspaceWrite"
      }
    }
    default {
      return @{
        type = "dangerFullAccess"
      }
    }
  }
}

function Get-AttachmentInputs {
  param([string]$ManifestPath)

  if ([string]::IsNullOrWhiteSpace($ManifestPath) -or -not (Test-Path $ManifestPath)) {
    return @()
  }

  try {
    $raw = Get-Content -Path $ManifestPath -Raw -ErrorAction Stop
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return @()
  }

  $inputs = @()
  foreach ($attachment in @($parsed.attachments)) {
    $kind = [string]$attachment.kind
    $path = [string]$attachment.path
    if ($kind -ne "image" -or [string]::IsNullOrWhiteSpace($path) -or -not (Test-Path $path)) {
      continue
    }

    $inputs += @{
      type = "localImage"
      path = $path
    }
  }

  return $inputs
}

function Ensure-AppServer {
  if (Test-Path $pidFile) {
    $existingPid = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingPid) {
      $existingProcess = Get-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
      if ($existingProcess -and (Wait-AppServerPort -Port $AppServerPort)) {
        return
      }
    }

    Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
  }

  if (Wait-AppServerPort -Port $AppServerPort) {
    return
  }

  $codex = (Get-Command codex -ErrorAction Stop).Source
  $process = Start-Process `
    -FilePath $codex `
    -ArgumentList @(
      "app-server",
      "--listen", $wsUrl,
      "-c", 'approval_policy="never"',
      "-c", 'sandbox_mode="danger-full-access"'
    ) `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -Path $pidFile -Value $process.Id

  if (-not (Wait-AppServerPort -Port $AppServerPort)) {
    throw "Codex app-server did not start listening on port $AppServerPort."
  }
}

function Send-Json {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Client,
    $Object
  )

  $json = $Object | ConvertTo-Json -Depth 30 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $Client.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null
}

function Receive-Json {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Client,
    [int]$TimeoutMs = 15000
  )

  $buffer = New-Object byte[] 65536
  $stream = New-Object System.IO.MemoryStream
  $cts = [Threading.CancellationTokenSource]::new($TimeoutMs)

  try {
    do {
      $segment = [ArraySegment[byte]]::new($buffer)
      $result = $Client.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw "The Codex app-server closed the WebSocket connection."
      }

      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)
  } finally {
    $cts.Dispose()
  }

  $text = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $text | ConvertFrom-Json
}

function Invoke-Rpc {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Client,
    [int]$Id,
    [string]$Method,
    $Params = $null
  )

  $request = @{
    jsonrpc = "2.0"
    id = $Id
    method = $Method
  }

  if ($null -ne $Params) {
    $request.params = $Params
  }

  Send-Json -Client $Client -Object $request

  while ($true) {
    $message = Receive-Json -Client $Client

    if ($null -eq $message.id) {
      continue
    }

    if ([string]$message.id -ne [string]$Id) {
      continue
    }

    if ($null -ne $message.error) {
      $detail = $message.error | ConvertTo-Json -Depth 20 -Compress
      throw "Codex app-server rejected ${Method}: $detail"
    }

    return $message.result
  }
}

$turnSandboxPolicy = Get-TurnSandboxPolicy -Mode $SandboxMode
$attachmentInputs = Get-AttachmentInputs -ManifestPath $AttachmentsManifestPath
$userInputs = @(
  @{
    type = "text"
    text = $promptText
  }
)
if ($attachmentInputs.Count -gt 0) {
  $userInputs += $attachmentInputs
}

Ensure-AppServer

$client = [System.Net.WebSockets.ClientWebSocket]::new()

try {
  $client.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

  Invoke-Rpc -Client $client -Id 1 -Method "initialize" -Params @{
    clientInfo = @{
      name = "codex-live-view"
      version = "0.1.0"
    }
    capabilities = @{
      experimentalApi = $true
    }
  } | Out-Null

  Send-Json -Client $client -Object @{
    jsonrpc = "2.0"
    method = "initialized"
  }

  $resume = Invoke-Rpc -Client $client -Id 2 -Method "thread/resume" -Params @{
    threadId = $ThreadId
    approvalPolicy = $approvalPolicy
    sandbox = $threadSandboxMode
    cwd = $repoRoot
  }

  $activeTurn = $null
  foreach ($turn in @($resume.thread.turns)) {
    if ($turn.status -eq "inProgress") {
      $activeTurn = $turn
    }
  }

  if ($activeTurn) {
    if ($DisallowSteer.IsPresent) {
      [pscustomobject]@{
        ok = $true
        mode = "busy"
        threadId = $ThreadId
        turnId = $activeTurn.id
      } | ConvertTo-Json -Compress

      exit 0
    }

    try {
      $steered = Invoke-Rpc -Client $client -Id 3 -Method "turn/steer" -Params @{
        threadId = $ThreadId
        expectedTurnId = $activeTurn.id
        input = $userInputs
      }

      $steeredTurnId = $activeTurn.id
      if ($steered -and $steered.turn -and $steered.turn.id) {
        $steeredTurnId = $steered.turn.id
      }

      [pscustomobject]@{
        ok = $true
        mode = "steer"
        threadId = $ThreadId
        turnId = $steeredTurnId
      } | ConvertTo-Json -Compress

      exit 0
    } catch {
    }

    [pscustomobject]@{
      ok = $true
      mode = "busy"
      threadId = $ThreadId
      turnId = $activeTurn.id
    } | ConvertTo-Json -Compress

    exit 0
  }

  $start = Invoke-Rpc -Client $client -Id 3 -Method "turn/start" -Params @{
    threadId = $ThreadId
    approvalPolicy = $approvalPolicy
    sandboxPolicy = $turnSandboxPolicy
    input = $userInputs
  }

  [pscustomobject]@{
    ok = $true
    mode = "start"
    threadId = $ThreadId
    turnId = $start.turn.id
  } | ConvertTo-Json -Compress
} finally {
  if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    try {
      $client.CloseAsync(
        [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "done",
        [Threading.CancellationToken]::None
      ).GetAwaiter().GetResult() | Out-Null
    } catch {
    }
  }

  $client.Dispose()
}

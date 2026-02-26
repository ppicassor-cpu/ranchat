param(
  [string]$ServerHost = "152.67.213.225",
  [string]$User = "ubuntu",
  [string]$KeyPath = "C:\\Users\\Home\\Downloads\\ssh-key-2025-12-30.key",
  [string]$EnvFile = ".env",
  [string]$Pm2Name = "rtc-signal",
  [string]$AppleNativeClientId = "com.ranchat"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvValue {
  param(
    [string]$Content,
    [string]$Key
  )

  $pattern = "(?m)^[ \t]*$([Regex]::Escape($Key))[ \t]*=[ \t]*(.*)$"
  $m = [Regex]::Match($Content, $pattern)
  if (-not $m.Success) { return "" }

  $raw = $m.Groups[1].Value.Trim()
  if ($raw.StartsWith('"') -and $raw.EndsWith('"') -and $raw.Length -ge 2) {
    return $raw.Substring(1, $raw.Length - 2)
  }
  if ($raw.StartsWith("'") -and $raw.EndsWith("'") -and $raw.Length -ge 2) {
    return $raw.Substring(1, $raw.Length - 2)
  }
  return $raw
}

function Escape-BashSingleQuote {
  param([string]$Value)
  return $Value.Replace("'", "'""'""'")
}

function Test-GoogleClientId {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  return ($Value -match '^[0-9]+-[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$')
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

$envContent = Get-Content -Encoding UTF8 -Raw -LiteralPath $EnvFile

$publicBase = Get-EnvValue -Content $envContent -Key "EXPO_PUBLIC_AUTH_HTTP_BASE_URL"
$googleWebClientId = Get-EnvValue -Content $envContent -Key "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"
$googleIosClientId = Get-EnvValue -Content $envContent -Key "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"

if (-not (Test-GoogleClientId -Value $googleWebClientId)) {
  throw "Invalid EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID format in $EnvFile"
}
if (-not (Test-GoogleClientId -Value $googleIosClientId)) {
  throw "Invalid EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID format in $EnvFile"
}

$kv = [ordered]@{}
if ($publicBase) { $kv["PUBLIC_BASE_URL"] = $publicBase }
$kv["GOOGLE_WEB_CLIENT_ID"] = $googleWebClientId
$kv["GOOGLE_IOS_CLIENT_ID"] = $googleIosClientId
if ($AppleNativeClientId) { $kv["APPLE_NATIVE_CLIENT_ID"] = $AppleNativeClientId }

if ($kv.Count -eq 0) {
  throw "No social env values found in $EnvFile."
}

$assignments = @()
foreach ($entry in $kv.GetEnumerator()) {
  $escaped = Escape-BashSingleQuote -Value ([string]$entry.Value)
  $assignments += "$($entry.Key)='$escaped'"
}
$envPrefix = ($assignments -join " ")

$remoteCmd = @(
  "$envPrefix pm2 restart $Pm2Name --update-env"
  "pm2 save"
  "pm2 status $Pm2Name --no-color | head -n 20"
) -join "; "

Write-Host "Applying env to $User@$ServerHost ($Pm2Name)..."
ssh -i $KeyPath "$User@$ServerHost" $remoteCmd
if ($LASTEXITCODE -ne 0) {
  throw "SSH command failed (exit code: $LASTEXITCODE)"
}
Write-Host "Done."

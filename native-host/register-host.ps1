param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.wise.chrome_plugin_host'
$hostDir = $PSScriptRoot
$templatePath = Join-Path $hostDir 'com.wise.chrome_plugin_host.template.json'
$manifestOutputDir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\NativeMessagingHosts'
$manifestOutputPath = Join-Path $manifestOutputDir "$hostName.json"
$cmdPath = Join-Path $hostDir 'host.cmd'
$regKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Template not found: $templatePath"
}

if (-not (Test-Path -LiteralPath $cmdPath)) {
  throw "Host launcher not found: $cmdPath"
}

New-Item -ItemType Directory -Force -Path $manifestOutputDir | Out-Null

$template = Get-Content -LiteralPath $templatePath -Raw
$manifest = $template.Replace('__HOST_CMD_PATH__', $cmdPath.Replace('\', '\\'))
$manifest = $manifest.Replace('__EXTENSION_ID__', $ExtensionId)
Set-Content -LiteralPath $manifestOutputPath -Value $manifest -Encoding UTF8

New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name '(default)' -Value $manifestOutputPath

Write-Host "Native host registered:"
Write-Host "  Host manifest: $manifestOutputPath"
Write-Host "  Extension ID : $ExtensionId"

$ErrorActionPreference = 'Stop'

function Read-NativeMessage {
  $stdin = [Console]::OpenStandardInput()
  $lengthBytes = New-Object byte[] 4
  $read = $stdin.Read($lengthBytes, 0, 4)
  if ($read -ne 4) {
    return $null
  }

  $length = [BitConverter]::ToInt32($lengthBytes, 0)
  if ($length -le 0) {
    return $null
  }

  $buffer = New-Object byte[] $length
  $offset = 0
  while ($offset -lt $length) {
    $chunk = $stdin.Read($buffer, $offset, $length - $offset)
    if ($chunk -le 0) {
      break
    }
    $offset += $chunk
  }

  if ($offset -ne $length) {
    throw 'Native message body read incomplete'
  }

  $json = [Text.Encoding]::UTF8.GetString($buffer)
  return $json | ConvertFrom-Json
}

function Write-NativeMessage([object]$payload) {
  $stdout = [Console]::OpenStandardOutput()
  $json = $payload | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $lengthBytes = [BitConverter]::GetBytes($bytes.Length)
  $stdout.Write($lengthBytes, 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}


function Rebuild-Index {
  $baseDir = Split-Path -Parent $PSScriptRoot
  $scriptsDir = Join-Path $baseDir 'scripts'
  $indexPath = Join-Path $scriptsDir 'index.json'

  if (-not (Test-Path -LiteralPath $scriptsDir)) {
    throw "Scripts directory not found: $scriptsDir"
  }

  $items = @(Get-ChildItem -LiteralPath $scriptsDir -Filter *.js -File |
    Sort-Object Name |
    ForEach-Object {
      $id = [IO.Path]::GetFileNameWithoutExtension($_.Name)
      [PSCustomObject]@{
        id = $id
        name = $_.Name
        path = "scripts/$($_.Name)"
        description = $id
      }
    })

  $json = @($items) | ConvertTo-Json -Depth 5
  if (-not $json) {
    $json = '[]'
  }
  Set-Content -LiteralPath $indexPath -Value $json -Encoding UTF8

  return @{
    ok = $true
    count = @($items).Count
    indexPath = $indexPath
  }
}


function Get-SafeFileName([string]$fileName) {
  $baseName = [IO.Path]::GetFileNameWithoutExtension($fileName)
  $extension = [IO.Path]::GetExtension($fileName)
  if ([string]::IsNullOrWhiteSpace($extension)) {
    $extension = '.js'
  }

  $safeBaseName = ($baseName -replace '[^\w\u4e00-\u9fa5-]+', '-') -replace '-+', '-'
  $safeBaseName = $safeBaseName.Trim('-')
  if ([string]::IsNullOrWhiteSpace($safeBaseName)) {
    $safeBaseName = 'script'
  }

  return "$safeBaseName$extension"
}


function Import-Script([string]$fileName, [string]$content) {
  if ([string]::IsNullOrWhiteSpace($fileName)) {
    throw 'fileName is required'
  }

  $baseDir = Split-Path -Parent $PSScriptRoot
  $scriptsDir = Join-Path $baseDir 'scripts'
  if (-not (Test-Path -LiteralPath $scriptsDir)) {
    throw "Scripts directory not found: $scriptsDir"
  }

  $safeFileName = Get-SafeFileName $fileName
  $targetPath = Join-Path $scriptsDir $safeFileName
  Set-Content -LiteralPath $targetPath -Value $content -Encoding UTF8

  $result = Rebuild-Index
  $result.importedFile = $safeFileName
  return $result
}

function Delete-Script([string]$fileName) {
  if ([string]::IsNullOrWhiteSpace($fileName)) {
    throw 'fileName is required'
  }

  $baseDir = Split-Path -Parent $PSScriptRoot
  $scriptsDir = Join-Path $baseDir 'scripts'
  if (-not (Test-Path -LiteralPath $scriptsDir)) {
    throw "Scripts directory not found: $scriptsDir"
  }

  $safeFileName = Get-SafeFileName $fileName
  $targetPath = Join-Path $scriptsDir $safeFileName
  if (-not (Test-Path -LiteralPath $targetPath)) {
    throw "Script file not found: $safeFileName"
  }

  Remove-Item -LiteralPath $targetPath -Force

  $result = Rebuild-Index
  $result.deletedFile = $safeFileName
  return $result
}

function Open-Script([string]$fileName) {
  if ([string]::IsNullOrWhiteSpace($fileName)) {
    throw 'fileName is required'
  }

  $baseDir = Split-Path -Parent $PSScriptRoot
  $scriptsDir = Join-Path $baseDir 'scripts'
  if (-not (Test-Path -LiteralPath $scriptsDir)) {
    throw "Scripts directory not found: $scriptsDir"
  }

  $safeFileName = Get-SafeFileName $fileName
  $targetPath = Join-Path $scriptsDir $safeFileName
  if (-not (Test-Path -LiteralPath $targetPath)) {
    throw "Script file not found: $safeFileName"
  }

  Start-Process -FilePath $targetPath

  return @{
    ok = $true
    openedFile = $safeFileName
    filePath = $targetPath
  }
}


try {
  $message = Read-NativeMessage
  if ($null -eq $message) {
    exit 0
  }

  switch ($message.action) {
    'importScript' {
      Write-NativeMessage (Import-Script -fileName $message.fileName -content $message.content)
    }
    'deleteScript' {
      Write-NativeMessage (Delete-Script -fileName $message.fileName)
    }
    'openScript' {
      Write-NativeMessage (Open-Script -fileName $message.fileName)
    }
    default {
      Write-NativeMessage @{
        ok = $false
        error = "Unsupported action: $($message.action)"
      }
    }
  }
} catch {
  Write-NativeMessage @{
    ok = $false
    error = $_.Exception.Message
  }
  exit 1
}
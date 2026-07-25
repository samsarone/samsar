[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $SetupArguments
)

$ErrorActionPreference = 'Stop'
$DockerDesktopExecutable = Join-Path $Env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerCliDirectory = Join-Path $Env:ProgramFiles 'Docker\Docker\resources\bin'

function Update-DockerCliPath {
  if ((Test-Path $DockerCliDirectory) -and ($Env:Path -notlike "*$DockerCliDirectory*")) {
    $Env:Path = "$DockerCliDirectory;$Env:Path"
  }
}

Update-DockerCliPath

function Test-DockerEngine {
  try {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Install-DockerDesktop {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is missing and winget is unavailable. Install Docker Desktop, enable WSL integration, and rerun setup.ps1.'
  }

  Write-Host '[setup-wizard] Installing Docker Desktop with winget...'
  & winget.exe install --exact --id Docker.DockerDesktop `
    --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Desktop installation failed.'
  }
  Update-DockerCliPath
}

function Start-DockerDesktop {
  if (-not (Test-Path $DockerDesktopExecutable)) {
    Install-DockerDesktop
  }

  if (-not (Test-DockerEngine)) {
    Write-Host '[setup-wizard] Starting Docker Desktop...'
    Start-Process -FilePath $DockerDesktopExecutable | Out-Null
    foreach ($Attempt in 1..90) {
      Start-Sleep -Seconds 2
      if (Test-DockerEngine) {
        return
      }
    }
    throw 'Docker Desktop did not become ready within three minutes.'
  }
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw 'WSL 2 is required for the Windows launcher. Run "wsl --install", restart Windows, and rerun setup.ps1.'
}

Start-DockerDesktop

$WslRoot = (& wsl.exe wslpath -a -u $PSScriptRoot).Trim()
if ($LASTEXITCODE -ne 0 -or -not $WslRoot) {
  throw 'Could not translate the Samsar checkout path into WSL.'
}

& wsl.exe docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is running, but this WSL distribution cannot access it. Enable Docker Desktop WSL integration and rerun setup.ps1.'
}

$WslArguments = @(
  '--cd',
  $WslRoot,
  'env',
  'SAMSAR_SETUP_BOOTSTRAP=0',
  './setup.sh'
) + $SetupArguments
& wsl.exe @WslArguments
exit $LASTEXITCODE

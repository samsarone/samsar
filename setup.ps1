[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $SetupArguments
)

$ErrorActionPreference = 'Stop'
$MinimumDockerDesktopVersion = [Version] '4.84.0'
$DockerDesktopPackageId = 'Docker.DockerDesktop'
$DockerDesktopInstallGuide = 'https://docs.docker.com/desktop/setup/install/windows-install/'
$DockerDesktopExecutable = $null
$DockerCliDirectory = $null

function Test-EnvironmentFlagEnabled {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  $Value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  switch ($Value.Trim().ToLowerInvariant()) {
    '0' { return $false }
    'false' { return $false }
    'no' { return $false }
    'off' { return $false }
    default { return $true }
  }
}

$BootstrapEnabled = Test-EnvironmentFlagEnabled -Name 'SAMSAR_SETUP_BOOTSTRAP'
$InstallDockerEnabled = Test-EnvironmentFlagEnabled -Name 'SAMSAR_SETUP_INSTALL_DOCKER'

function ConvertTo-DockerDesktopVersion {
  param(
    [AllowNull()]
    [object] $Value
  )

  if ($null -eq $Value) {
    return $null
  }

  $Match = [regex]::Match(([string] $Value), '\d+(?:\.\d+){1,3}')
  if (-not $Match.Success) {
    return $null
  }

  try {
    return [Version] $Match.Value
  } catch {
    return $null
  }
}

function Get-DockerDesktopRegistryEntries {
  $RegistryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  $Entries = @()

  foreach ($RegistryRoot in $RegistryRoots) {
    try {
      $RegistryItems = @(Get-ChildItem -LiteralPath $RegistryRoot -ErrorAction SilentlyContinue)
    } catch {
      continue
    }

    foreach ($RegistryItem in $RegistryItems) {
      try {
        $Entry = Get-ItemProperty -LiteralPath $RegistryItem.PSPath -ErrorAction Stop
      } catch {
        continue
      }

      if (([string] $Entry.DisplayName) -ieq 'Docker Desktop') {
        $Entries += $Entry
      }
    }
  }

  return $Entries
}

function Get-DockerDesktopExecutableCandidates {
  param(
    [Parameter(Mandatory = $true)]
    [object] $RegistryEntry
  )

  $Candidates = @()
  if (-not [string]::IsNullOrWhiteSpace([string] $RegistryEntry.InstallLocation)) {
    $InstallLocation = ([string] $RegistryEntry.InstallLocation).Trim().Trim('"').TrimEnd('\')
    if (-not [string]::IsNullOrWhiteSpace($InstallLocation)) {
      $Candidates += Join-Path $InstallLocation 'Docker Desktop.exe'
    }
  }

  if (-not [string]::IsNullOrWhiteSpace([string] $RegistryEntry.DisplayIcon)) {
    $DisplayIcon = ([string] $RegistryEntry.DisplayIcon).Trim()
    if ($DisplayIcon.StartsWith('"')) {
      $ClosingQuote = $DisplayIcon.IndexOf('"', 1)
      if ($ClosingQuote -gt 1) {
        $DisplayIcon = $DisplayIcon.Substring(1, $ClosingQuote - 1)
      }
    } else {
      $DisplayIcon = ($DisplayIcon -replace ',\s*-?\d+\s*$', '').Trim('"')
    }

    try {
      if ((Split-Path -Leaf $DisplayIcon) -ieq 'Docker Desktop.exe') {
        $Candidates += $DisplayIcon
      }
    } catch {
      # Ignore malformed third-party uninstall metadata and use the known paths below.
    }
  }

  return $Candidates
}

function Get-DockerDesktopExecutableVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ExecutablePath
  )

  try {
    $VersionInfo = (Get-Item -LiteralPath $ExecutablePath -ErrorAction Stop).VersionInfo
    $Version = ConvertTo-DockerDesktopVersion -Value $VersionInfo.ProductVersion
    if ($null -ne $Version) {
      return $Version
    }
    return ConvertTo-DockerDesktopVersion -Value $VersionInfo.FileVersion
  } catch {
    return $null
  }
}

function New-DockerDesktopInstallation {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ExecutablePath,

    [AllowNull()]
    [object] $RegistryVersion
  )

  $Version = ConvertTo-DockerDesktopVersion -Value $RegistryVersion
  if ($null -eq $Version) {
    $Version = Get-DockerDesktopExecutableVersion -ExecutablePath $ExecutablePath
  }

  return [PSCustomObject] @{
    ExecutablePath = $ExecutablePath
    Version = $Version
  }
}

function Get-DockerDesktopInstallation {
  $RegistryEntries = @(Get-DockerDesktopRegistryEntries)

  foreach ($RegistryEntry in $RegistryEntries) {
    $Candidates = @(Get-DockerDesktopExecutableCandidates -RegistryEntry $RegistryEntry)
    foreach ($Candidate in $Candidates) {
      if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
        return (New-DockerDesktopInstallation `
          -ExecutablePath $Candidate `
          -RegistryVersion $RegistryEntry.DisplayVersion)
      }
    }
  }

  $KnownExecutablePaths = @()
  if (-not [string]::IsNullOrWhiteSpace($Env:LOCALAPPDATA)) {
    $KnownExecutablePaths += Join-Path $Env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
  }
  if (-not [string]::IsNullOrWhiteSpace($Env:ProgramW6432)) {
    $KnownExecutablePaths += Join-Path $Env:ProgramW6432 'Docker\Docker\Docker Desktop.exe'
  }
  if (-not [string]::IsNullOrWhiteSpace($Env:ProgramFiles)) {
    $KnownExecutablePaths += Join-Path $Env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  }

  foreach ($KnownExecutablePath in ($KnownExecutablePaths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $KnownExecutablePath -PathType Leaf)) {
      continue
    }

    $RegistryVersion = $null
    $PreferCurrentUserEntry = -not [string]::IsNullOrWhiteSpace($Env:LOCALAPPDATA) -and
      $KnownExecutablePath.StartsWith($Env:LOCALAPPDATA, [StringComparison]::OrdinalIgnoreCase)
    foreach ($RegistryEntry in $RegistryEntries) {
      $IsCurrentUserEntry = ([string] $RegistryEntry.PSPath) -like '*HKEY_CURRENT_USER*'
      if ($IsCurrentUserEntry -eq $PreferCurrentUserEntry) {
        $RegistryVersion = $RegistryEntry.DisplayVersion
        break
      }
    }
    if ($null -eq $RegistryVersion -and $RegistryEntries.Count -eq 1) {
      $RegistryVersion = $RegistryEntries[0].DisplayVersion
    }

    return (New-DockerDesktopInstallation `
      -ExecutablePath $KnownExecutablePath `
      -RegistryVersion $RegistryVersion)
  }

  return $null
}

function Update-DockerCliPath {
  if ([string]::IsNullOrWhiteSpace($DockerCliDirectory) -or
      -not (Test-Path -LiteralPath $DockerCliDirectory -PathType Container)) {
    return
  }

  $PathEntries = @($Env:Path -split ';')
  if ($PathEntries -notcontains $DockerCliDirectory) {
    $Env:Path = "$DockerCliDirectory;$Env:Path"
  }
}

function Set-DockerDesktopInstallation {
  param(
    [Parameter(Mandatory = $true)]
    [object] $Installation
  )

  $script:DockerDesktopExecutable = [string] $Installation.ExecutablePath
  $DockerDesktopDirectory = Split-Path -Parent $script:DockerDesktopExecutable
  $script:DockerCliDirectory = Join-Path $DockerDesktopDirectory 'resources\bin'
  Update-DockerCliPath
}

function Test-DockerEngine {
  try {
    & docker info *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Test-DockerDesktopVersionSatisfied {
  param(
    [AllowNull()]
    [object] $Installation
  )

  return $null -ne $Installation -and
    $null -ne $Installation.Version -and
    $Installation.Version -ge $MinimumDockerDesktopVersion
}

function Get-DockerDesktopVersionDescription {
  param(
    [AllowNull()]
    [object] $Installation
  )

  if ($null -eq $Installation) {
    return 'not installed'
  }
  if ($null -eq $Installation.Version) {
    return 'version unknown'
  }
  return ([string] $Installation.Version)
}

function Assert-AutomaticDockerChangeEnabled {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Action
  )

  $ManualInstruction = "Install or update Docker Desktop to $MinimumDockerDesktopVersion or newer from $DockerDesktopInstallGuide, enable WSL 2 integration, and rerun setup.ps1."
  if (-not $BootstrapEnabled) {
    throw "Docker Desktop $Action is required, but host bootstrap is disabled by SAMSAR_SETUP_BOOTSTRAP=0. $ManualInstruction"
  }
  if (-not $InstallDockerEnabled) {
    throw "Docker Desktop $Action is required, but automatic Docker installation and updates are disabled by SAMSAR_SETUP_INSTALL_DOCKER=0. $ManualInstruction"
  }
}

function Invoke-NativeProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,

    [Parameter(Mandatory = $true)]
    [string[]] $ArgumentList
  )

  $Process = Start-Process -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -Wait -NoNewWindow -PassThru
  return [int] $Process.ExitCode
}

function Install-DockerDesktop {
  Assert-AutomaticDockerChangeEnabled -Action 'installation'
  $WingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -eq $WingetCommand) {
    throw "Docker Desktop is missing and winget is unavailable. Install Docker Desktop $MinimumDockerDesktopVersion or newer from $DockerDesktopInstallGuide, enable WSL 2 integration, and rerun setup.ps1."
  }

  Write-Host "[setup-wizard] Installing Docker Desktop $MinimumDockerDesktopVersion or newer with winget..."
  try {
    $WingetExitCode = Invoke-NativeProcess -FilePath $WingetCommand.Source -ArgumentList @(
      'install',
      '--exact',
      '--id', $DockerDesktopPackageId,
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity'
    )
  } catch {
    throw "Docker Desktop installation could not start: $($_.Exception.Message) Install Docker Desktop $MinimumDockerDesktopVersion or newer from $DockerDesktopInstallGuide, then rerun setup.ps1."
  }
  if ($WingetExitCode -ne 0) {
    throw "Docker Desktop installation failed with winget exit code $WingetExitCode. Install Docker Desktop $MinimumDockerDesktopVersion or newer from $DockerDesktopInstallGuide, then rerun setup.ps1."
  }
}

function Wait-ForCompatibleDockerDesktopInstallation {
  param(
    [int] $Attempts = 60
  )

  $Installation = $null
  foreach ($Attempt in 1..$Attempts) {
    $Installation = Get-DockerDesktopInstallation
    if (Test-DockerDesktopVersionSatisfied -Installation $Installation) {
      return $Installation
    }
    if ($Attempt -lt $Attempts) {
      Start-Sleep -Seconds 1
    }
  }
  return $Installation
}

function Update-DockerDesktop {
  param(
    [Parameter(Mandatory = $true)]
    [object] $Installation
  )

  Assert-AutomaticDockerChangeEnabled -Action 'update'
  Set-DockerDesktopInstallation -Installation $Installation

  $DockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  $DockerDesktopUpdaterAvailable = $false
  if ($null -ne $DockerCommand) {
    try {
      & docker desktop update --help *> $null
      $DockerDesktopUpdaterAvailable = $LASTEXITCODE -eq 0
    } catch {
      $DockerDesktopUpdaterAvailable = $false
    }
  }

  if ($DockerDesktopUpdaterAvailable) {
    Write-Host "[setup-wizard] Updating Docker Desktop to $MinimumDockerDesktopVersion or newer with Docker Desktop's updater..."
    $DockerUpdaterExitCode = -1
    try {
      $DockerUpdaterExitCode = Invoke-NativeProcess `
        -FilePath $DockerCommand.Source `
        -ArgumentList @('desktop', 'update', '--quiet')
    } catch {
      Write-Warning "Docker Desktop's updater could not be started: $($_.Exception.Message)"
    }

    if ($DockerUpdaterExitCode -eq 0) {
      $UpdatedInstallation = Wait-ForCompatibleDockerDesktopInstallation
      if (Test-DockerDesktopVersionSatisfied -Installation $UpdatedInstallation) {
        return $UpdatedInstallation
      }
      $DetectedVersion = Get-DockerDesktopVersionDescription -Installation $UpdatedInstallation
      Write-Warning "Docker Desktop's updater completed, but the detected version is still $DetectedVersion. Trying winget."
    } else {
      Write-Warning "Docker Desktop's updater exited with code $DockerUpdaterExitCode. Trying winget."
    }
  }

  $WingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -eq $WingetCommand) {
    $DetectedInstallation = Get-DockerDesktopInstallation
    $DetectedVersion = Get-DockerDesktopVersionDescription -Installation $DetectedInstallation
    throw "Docker Desktop $MinimumDockerDesktopVersion or newer is required; detected $DetectedVersion. The built-in update did not reach the required version and winget is unavailable. Update manually from $DockerDesktopInstallGuide, then rerun setup.ps1. No uninstall or data-destructive fallback was attempted."
  }

  Write-Host "[setup-wizard] Updating Docker Desktop to $MinimumDockerDesktopVersion or newer with winget..."
  try {
    $WingetExitCode = Invoke-NativeProcess -FilePath $WingetCommand.Source -ArgumentList @(
      'upgrade',
      '--exact',
      '--id', $DockerDesktopPackageId,
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
      '--include-unknown'
    )
  } catch {
    throw "Docker Desktop update could not start: $($_.Exception.Message) Update manually from $DockerDesktopInstallGuide, then rerun setup.ps1. No uninstall or data-destructive fallback was attempted."
  }
  $UpdatedInstallation = Wait-ForCompatibleDockerDesktopInstallation
  if (Test-DockerDesktopVersionSatisfied -Installation $UpdatedInstallation) {
    return $UpdatedInstallation
  }

  $DetectedVersion = Get-DockerDesktopVersionDescription -Installation $UpdatedInstallation
  throw "Docker Desktop update did not reach $MinimumDockerDesktopVersion or newer (detected $DetectedVersion; winget exit code $WingetExitCode). Update manually from $DockerDesktopInstallGuide, then rerun setup.ps1. The launcher deliberately did not uninstall or reinstall Docker Desktop, so it did not remove local Docker data."
}

function Ensure-DockerDesktop {
  $Installation = Get-DockerDesktopInstallation
  if ($null -eq $Installation) {
    Install-DockerDesktop
    $Installation = Wait-ForCompatibleDockerDesktopInstallation
    if ($null -eq $Installation) {
      throw "Docker Desktop installation completed, but its executable could not be found. Restart Windows if requested by the installer, or install Docker Desktop from $DockerDesktopInstallGuide, then rerun setup.ps1."
    }
  }

  Set-DockerDesktopInstallation -Installation $Installation
  if (Test-DockerDesktopVersionSatisfied -Installation $Installation) {
    Write-Host "[setup-wizard] Docker Desktop $($Installation.Version) satisfies the minimum version ($MinimumDockerDesktopVersion)."
    return $Installation
  }

  $DetectedVersion = Get-DockerDesktopVersionDescription -Installation $Installation
  Write-Warning "Docker Desktop $DetectedVersion does not satisfy the required minimum version $MinimumDockerDesktopVersion."
  $Installation = Update-DockerDesktop -Installation $Installation
  Set-DockerDesktopInstallation -Installation $Installation
  Write-Host "[setup-wizard] Docker Desktop updated to $($Installation.Version)."
  return $Installation
}

function Start-DockerDesktop {
  if ([string]::IsNullOrWhiteSpace($DockerDesktopExecutable) -or
      -not (Test-Path -LiteralPath $DockerDesktopExecutable -PathType Leaf)) {
    throw "Docker Desktop's executable could not be found after installation validation. Install Docker Desktop from $DockerDesktopInstallGuide, then rerun setup.ps1."
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
    throw 'Docker Desktop did not become ready within three minutes. Open Docker Desktop, resolve any WSL 2 prompt it shows, and rerun setup.ps1.'
  }
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw 'WSL 2 is required for the Windows launcher. Run "wsl --install", restart Windows, and rerun setup.ps1.'
}

$DockerDesktopInstallation = Ensure-DockerDesktop
Start-DockerDesktop

$PreviousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $WslRootOutput = & wsl.exe wslpath -a -u $PSScriptRoot 2> $null
  $WslPathExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $PreviousErrorActionPreference
}
$WslRoot = ([string] ($WslRootOutput -join "`n")).Trim()
if ($WslPathExitCode -ne 0 -or -not $WslRoot) {
  throw 'Could not translate the Samsar checkout path into WSL.'
}

try {
  $ErrorActionPreference = 'Continue'
  & wsl.exe docker info *> $null
  $WslDockerExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $PreviousErrorActionPreference
}
if ($WslDockerExitCode -ne 0) {
  throw 'Docker Desktop is running, but this WSL distribution cannot access it. Enable Docker Desktop WSL integration and rerun setup.ps1.'
}

$WslArguments = @(
  '--cd',
  $WslRoot,
  'env',
  'SAMSAR_SETUP_BOOTSTRAP=0',
  './setup.sh'
) + $SetupArguments
try {
  $ErrorActionPreference = 'Continue'
  & wsl.exe @WslArguments
  $WslSetupExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $PreviousErrorActionPreference
}
exit $WslSetupExitCode

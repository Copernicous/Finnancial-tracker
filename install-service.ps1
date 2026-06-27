# ============================================================
# Home Accounting -- Windows Service Installer
#
# Run from the folder that contains server.exe:
#   powershell -ExecutionPolicy Bypass -File .\install-service.ps1
#
# Expected layout:
#   C:\HomeAccounting\
#     APP\
#       server.exe
#       .env
#       install-service.ps1
#       uninstall-service.ps1
#     logs\
#     nssm\
# ============================================================

$ServiceName = "HomeAccountingSystem"
$DisplayName = "Home Accounting"
$Description = "Home Accounting Management System -- Web Server"
$AppDir = $PSScriptRoot
$ParentDir = Split-Path $AppDir -Parent
$ServerExe = Join-Path $AppDir "server.exe"
$NssmDir = Join-Path $ParentDir "nssm"
$NssmExe = Join-Path $NssmDir "win64\nssm.exe"
$LogDir = Join-Path $ParentDir "logs"
$EnvFile = Join-Path $AppDir ".env"
$FallbackEnvFile = Join-Path $ParentDir ".env"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host ""
    Write-Host "  [ERROR] This script must be run as Administrator." -ForegroundColor Red
    Write-Host "  Right-click PowerShell -> Run as Administrator" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "  Home Accounting -- Service Installer" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $ServerExe)) {
    Write-Host "  [ERROR] server.exe not found at: $ServerExe" -ForegroundColor Red
    pause
    exit 1
}

if (-not (Test-Path $EnvFile) -and (Test-Path $FallbackEnvFile)) {
    $EnvFile = $FallbackEnvFile
}

Write-Host "  [OK] server.exe   : $ServerExe" -ForegroundColor Green
Write-Host "  [OK] App folder   : $AppDir" -ForegroundColor Green
Write-Host "  [OK] Logs folder  : $LogDir" -ForegroundColor Green
Write-Host "  [OK] NSSM folder  : $NssmDir" -ForegroundColor Green
if (Test-Path $EnvFile) {
    Write-Host "  [OK] .env file    : $EnvFile" -ForegroundColor Green
} else {
    Write-Host "  [WARN] .env file not found next to server.exe or in parent folder." -ForegroundColor Yellow
}
Write-Host ""

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
    Write-Host "  [OK] Created logs directory." -ForegroundColor Green
}

if (-not (Test-Path $NssmExe)) {
    Write-Host "  [..] Downloading NSSM (service manager)..." -ForegroundColor Yellow
    $NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $ZipPath = Join-Path $env:TEMP "nssm.zip"
    $ExtractDir = Join-Path $env:TEMP "nssm-extract"
    try {
        Invoke-WebRequest -Uri $NssmUrl -OutFile $ZipPath -UseBasicParsing
        Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
        $Extracted = Get-ChildItem $ExtractDir -Recurse -Filter "nssm.exe" |
            Where-Object { $_.FullName -like "*win64*" } |
            Select-Object -First 1
        if (-not $Extracted) { throw "nssm.exe not found in archive" }
        New-Item -ItemType Directory -Path (Split-Path $NssmExe -Parent) -Force | Out-Null
        Copy-Item $Extracted.FullName $NssmExe -Force
        Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] NSSM installed." -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Failed to download NSSM: $_" -ForegroundColor Red
        Write-Host "  Download from: https://nssm.cc/download" -ForegroundColor Yellow
        Write-Host "  Place nssm.exe at: $NssmExe" -ForegroundColor Yellow
        pause
        exit 1
    }
} else {
    Write-Host "  [OK] NSSM found." -ForegroundColor Green
}

$Existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($Existing) {
    Write-Host "  [..] Removing existing service '$ServiceName'..." -ForegroundColor Yellow
    if ($Existing.Status -eq "Running") {
        & $NssmExe stop $ServiceName confirm | Out-Null
        Start-Sleep 2
    }
    & $NssmExe remove $ServiceName confirm | Out-Null
    Write-Host "  [OK] Old service removed." -ForegroundColor Green
}

Write-Host "  [..] Installing service..." -ForegroundColor Yellow
& $NssmExe install $ServiceName $ServerExe

& $NssmExe set $ServiceName DisplayName $DisplayName
& $NssmExe set $ServiceName Description $Description
& $NssmExe set $ServiceName AppDirectory $AppDir
& $NssmExe set $ServiceName Start SERVICE_AUTO_START

& $NssmExe set $ServiceName AppStdout "$LogDir\server-stdout.log"
& $NssmExe set $ServiceName AppStderr "$LogDir\server-stderr.log"
& $NssmExe set $ServiceName AppStdoutCreationDisposition 4
& $NssmExe set $ServiceName AppStderrCreationDisposition 4
& $NssmExe set $ServiceName AppRotateFiles 1
& $NssmExe set $ServiceName AppRotateSeconds 86400
& $NssmExe set $ServiceName AppRotateBytes 10485760

& $NssmExe set $ServiceName AppThrottle 60000
& $NssmExe set $ServiceName AppRestartDelay 3000

if (Test-Path $EnvFile) {
    Write-Host "  [..] Loading .env..." -ForegroundColor Yellow
    $EnvPairs = @()
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $Key = $Matches[1].Trim()
            $Value = $Matches[2].Trim()
            $EnvPairs += "$Key=$Value"
        }
    }
    if ($EnvPairs.Count -gt 0) {
        & $NssmExe set $ServiceName AppEnvironmentExtra $EnvPairs | Out-Null
    }
    Write-Host "  [OK] .env loaded." -ForegroundColor Green
}

Write-Host "  [..] Starting service..." -ForegroundColor Yellow
& $NssmExe start $ServiceName
Start-Sleep 3

$Service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Write-Host ""
if ($Service -and $Service.Status -eq "Running") {
    Write-Host "  ================================================" -ForegroundColor Green
    Write-Host "  Service installed and RUNNING!" -ForegroundColor Green
    Write-Host "  Auto-starts on Windows boot." -ForegroundColor Green
    Write-Host "  Logs: $LogDir" -ForegroundColor Green
    Write-Host "  ================================================" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Service installed but may not have started." -ForegroundColor Yellow
    Write-Host "  Check: services.msc -> '$DisplayName'" -ForegroundColor Yellow
    Write-Host "  Check: $LogDir\server-stderr.log" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Commands:" -ForegroundColor Cyan
Write-Host "    Start  : net start $ServiceName" -ForegroundColor White
Write-Host "    Stop   : net stop  $ServiceName" -ForegroundColor White
Write-Host "    Status : sc query  $ServiceName" -ForegroundColor White
Write-Host "    Remove : .\uninstall-service.ps1" -ForegroundColor White
Write-Host ""
pause


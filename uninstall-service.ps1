# ============================================================
# Home Accounting -- Windows Service Uninstaller
#
# Run from the folder that contains server.exe:
#   powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1
# ============================================================

$ServiceName = "PatientRXSystem"
$AppDir = $PSScriptRoot
$ParentDir = Split-Path $AppDir -Parent
$NssmExe = Join-Path $ParentDir "nssm\win64\nssm.exe"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Host ""
    Write-Host "  [ERROR] Run as Administrator." -ForegroundColor Red
    Write-Host ""
    pause
    exit 1
}

$Service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $Service) {
    Write-Host ""
    Write-Host "  Service '$ServiceName' not found -- nothing to remove." -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 0
}

Write-Host ""
Write-Host "  Stopping and removing '$ServiceName'..." -ForegroundColor Yellow

if ($Service.Status -eq "Running") {
    if (Test-Path $NssmExe) {
        & $NssmExe stop $ServiceName confirm
    } else {
        net stop $ServiceName
    }
    Start-Sleep 2
}

if (Test-Path $NssmExe) {
    & $NssmExe remove $ServiceName confirm
} else {
    sc.exe delete $ServiceName
}

Write-Host "  [OK] Service removed." -ForegroundColor Green
Write-Host "  Note: logs in ..\logs\ were kept." -ForegroundColor Gray
Write-Host ""
pause


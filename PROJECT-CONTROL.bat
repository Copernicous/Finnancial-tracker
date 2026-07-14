@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ACTION=%~1"
if not defined ACTION set "ACTION=menu"
if "%~2"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\project-control.ps1" -Action "%ACTION%"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\project-control.ps1" -Action "%ACTION%" -Value "%~2"
)
endlocal & exit /b %ERRORLEVEL%

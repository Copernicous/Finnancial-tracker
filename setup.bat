@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not available on PATH.
    echo   Install Node.js, then reopen PowerShell or Command Prompt.
    echo.
    pause
    exit /b 1
)

node scripts\setup-windows.js %*
set "SETUP_EXIT=%ERRORLEVEL%"

echo.
pause
endlocal
exit /b %SETUP_EXIT%

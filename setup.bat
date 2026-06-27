@echo off
:: ============================================================
::  Home Accounting â€” New Server Setup Script
::  Run this ONCE on a fresh server to create the database
::  and restore from a backup.
::
::  Requirements before running:
::    1. PostgreSQL must be installed and running
::    2. Node.js must be installed
::    3. You must have a backup .dump file to restore from
::
::  Usage:
::    setup.bat                          (creates DB + tables only, no restore)
::    setup.bat restore backup.dump      (creates DB + restores from dump file)
:: ============================================================

title Home Accounting â€” Setup

:: â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
set DB_NAME=home_accounting_dev
set DB_USER=postgres
set DB_HOST=127.0.0.1

:: â”€â”€ Read password from .env if it exists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if exist ".env" (
    for /f "tokens=2 delims==" %%A in ('findstr /i "^DB_PASS=" .env') do set DB_PASS=%%A
) else (
    echo [!] .env file not found.
    set /p DB_PASS=Enter your PostgreSQL password: 
)

echo.
echo ============================================================
echo   Home Accounting - New Server Setup
echo ============================================================
echo   Database : %DB_NAME%
echo   Host     : %DB_HOST%
echo   User     : %DB_USER%
echo ============================================================
echo.

:: â”€â”€ Step 1: Check PostgreSQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [1/5] Checking PostgreSQL...
set PGPASSWORD=%DB_PASS%
psql -U %DB_USER% -h %DB_HOST% -c "\conninfo" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Cannot connect to PostgreSQL.
    echo   Make sure PostgreSQL is installed and running.
    echo   Download: https://www.postgresql.org/download/windows/
    echo.
    pause
    exit /b 1
)
echo   PostgreSQL connected OK.
echo.

:: â”€â”€ Step 2: Create database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
echo [2/5] Creating database "%DB_NAME%"...
psql -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME%;" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   Database may already exist â€” continuing...
)
echo   Database ready.
echo.

:: â”€â”€ Step 3: Check for restore or run migrations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if "%1"=="restore" (
    if "%2"=="" (
        echo [ERROR] Restore mode requires a .dump file path.
        echo   Usage: setup.bat restore "path\to\backup.dump"
        pause
        exit /b 1
    )
    echo [3/5] Restoring database from: %2
    pg_restore -U %DB_USER% -h %DB_HOST% -d %DB_NAME% --no-owner --no-privileges "%2"
    if %ERRORLEVEL% EQU 0 (
        echo   Database restored successfully!
    ) else (
        echo   Restore completed (warnings above are normal).
    )
    echo.
    echo [4/5] Skipping migrations (data already restored from dump).
    echo [5/5] Installing Node.js dependencies...
    call npm install
    echo.
    echo ============================================================
    echo   RESTORE COMPLETE!
    echo   Your database has been restored with all patient data.
    echo   Start the server: npm start
    echo   Then open: http://localhost:3000
    echo ============================================================
) else (
    echo [3/5] FRESH INSTALL: Running database migrations (creating tables)...
    call npm install
    call npx sequelize-cli db:migrate
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Migration failed. Check output above.
        pause
        exit /b 1
    )
    echo   Tables created successfully.
    echo.
    echo [4/5] Seeding initial data (admin user + default workflow)...
    call npx sequelize-cli db:seed:all
    if %ERRORLEVEL% NEQ 0 (
        echo [WARNING] Seeding failed. You may need to create the admin manually.
    )
    echo   Seed complete.
    echo.
    echo [5/5] Setup complete!
    echo.
    echo ============================================================
    echo   FRESH INSTALL COMPLETE!
    echo   Default admin login:
    echo     Username: admin
    echo     Password: admin123
    echo.
    echo   IMPORTANT: Change the admin password after first login!
    echo   Start the server: npm start
    echo   Then open: http://localhost:3000
    echo ============================================================
)

echo.
pause


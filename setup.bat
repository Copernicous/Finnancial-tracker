@echo off
setlocal EnableExtensions

rem ============================================================
rem  Home Accounting - New Server Setup Script
rem  Run this once on a fresh server to create the database
rem  and restore from a backup.
rem
rem  Requirements before running:
rem    1. PostgreSQL must be installed and running
rem    2. Node.js must be installed
rem    3. For restore mode, you must have a backup .dump file
rem
rem  Usage:
rem    setup.bat
rem    setup.bat restore "path\to\backup.dump"
rem ============================================================

title Home Accounting - Setup
cd /d "%~dp0"

rem Defaults. Values in .env override these.
set "DB_NAME=home_accounting_dev"
set "DB_USER=postgres"
set "DB_PASS="
set "DB_HOST=127.0.0.1"
set "DB_PORT=5432"

call :load_env
call :trim_var DB_NAME
call :trim_var DB_USER
call :trim_var DB_PASS
call :trim_var DB_HOST
call :trim_var DB_PORT

if not defined DB_PORT set "DB_PORT=5432"

if not defined DB_PASS (
    echo [!] DB_PASS is missing in .env.
    set /p "DB_PASS=Enter PostgreSQL password for %DB_USER%: "
    call :trim_var DB_PASS
)

if /i "%DB_PASS%"=="your_db_password_here" (
    echo [!] DB_PASS still has the placeholder value from .env.example.
    set /p "DB_PASS=Enter PostgreSQL password for %DB_USER%: "
    call :trim_var DB_PASS
)

call :find_postgres_tools
if errorlevel 1 goto :failed

call :check_node_tools
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   Home Accounting - New Server Setup
echo ============================================================
echo   Database : %DB_NAME%
echo   Host     : %DB_HOST%
echo   Port     : %DB_PORT%
echo   User     : %DB_USER%
echo   psql     : %PSQL_EXE%
echo ============================================================
echo.

echo [1/5] Checking PostgreSQL login...
set "PGPASSWORD=%DB_PASS%"
"%PSQL_EXE%" -U "%DB_USER%" -h "%DB_HOST%" -p "%DB_PORT%" -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1;" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot log in to PostgreSQL using the .env settings.
    echo.
    echo   Host: %DB_HOST%
    echo   Port: %DB_PORT%
    echo   User: %DB_USER%
    echo.
    echo   Notes:
    echo   - 127.0.0.1 is correct when PostgreSQL is on this same server.
    echo   - Check DB_PASS in .env and remove trailing spaces.
    echo   - Make sure the PostgreSQL Windows service is running.
    echo.
    echo   Manual test:
    echo   "%PSQL_EXE%" -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -c "SELECT 1;"
    echo.
    goto :failed
)
echo   PostgreSQL connected OK.
echo.

echo [2/5] Creating database "%DB_NAME%" if needed...
"%PSQL_EXE%" -U "%DB_USER%" -h "%DB_HOST%" -p "%DB_PORT%" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '%DB_NAME%';" | findstr /x "1" >nul
if errorlevel 1 (
    "%CREATEDB_EXE%" -U "%DB_USER%" -h "%DB_HOST%" -p "%DB_PORT%" "%DB_NAME%"
    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create database "%DB_NAME%".
        echo   Confirm that user "%DB_USER%" has CREATEDB permission.
        echo.
        goto :failed
    )
    echo   Database created.
) else (
    echo   Database already exists.
)
echo   Database ready.
echo.

if /i "%~1"=="restore" (
    if "%~2"=="" (
        echo [ERROR] Restore mode requires a .dump file path.
        echo   Usage: setup.bat restore "path\to\backup.dump"
        goto :failed
    )

    echo [3/5] Restoring database from: %~2
    "%PG_RESTORE_EXE%" -U "%DB_USER%" -h "%DB_HOST%" -p "%DB_PORT%" -d "%DB_NAME%" --no-owner --no-privileges "%~2"
    if errorlevel 1 (
        echo   Restore completed with warnings or errors. Review the output above.
    ) else (
        echo   Database restored successfully.
    )
    echo.

    echo [4/5] Skipping migrations because data was restored from dump.
    echo [5/5] Installing Node.js dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        goto :failed
    )

    echo.
    echo ============================================================
    echo   RESTORE COMPLETE
    echo   Start the server: npm start
    echo   Then open: http://localhost:3026
    echo ============================================================
) else (
    echo [3/5] FRESH INSTALL: Installing Node.js dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        goto :failed
    )
    echo.

    echo [4/5] Running database migrations...
    call npx sequelize-cli db:migrate
    if errorlevel 1 (
        echo [ERROR] Migration failed. Check output above.
        goto :failed
    )
    echo   Tables created successfully.
    echo.

    echo [5/5] Seeding initial data...
    call npx sequelize-cli db:seed:all
    if errorlevel 1 (
        echo [WARNING] Seeding failed. You may need to create the admin manually.
    ) else (
        echo   Seed complete.
    )
    echo.

    echo ============================================================
    echo   FRESH INSTALL COMPLETE
    echo   Default admin login:
    echo     Username: admin
    echo     Password: admin123
    echo.
    echo   IMPORTANT: Change the admin password after first login.
    echo   Start the server: npm start
    echo   Then open: http://localhost:3026
    echo ============================================================
)

echo.
pause
endlocal
exit /b 0

:failed
echo.
pause
endlocal
exit /b 1

:load_env
if not exist ".env" (
    echo [!] .env file not found. Defaults will be used where possible.
    exit /b 0
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="DB_NAME" set "DB_NAME=%%B"
    if /i "%%A"=="DB_USER" set "DB_USER=%%B"
    if /i "%%A"=="DB_PASS" set "DB_PASS=%%B"
    if /i "%%A"=="DB_HOST" set "DB_HOST=%%B"
    if /i "%%A"=="DB_PORT" set "DB_PORT=%%B"
)
exit /b 0

:trim_var
setlocal EnableDelayedExpansion
set "value=!%~1!"
for /f "tokens=* delims= " %%T in ("!value!") do set "value=%%T"
:trim_var_tail
if defined value if "!value:~-1!"==" " (
    set "value=!value:~0,-1!"
    goto :trim_var_tail
)
if defined value if "!value:~0,1!"=="^"" if "!value:~-1!"=="^"" set "value=!value:~1,-1!"
endlocal & set "%~1=%value%"
exit /b 0

:find_postgres_tools
set "PSQL_EXE="

for /f "delims=" %%P in ('where psql.exe 2^>nul') do (
    if not defined PSQL_EXE set "PSQL_EXE=%%P"
)

if not defined PSQL_EXE (
    if defined ProgramW6432 (
        for /d %%D in ("%ProgramW6432%\PostgreSQL\*") do (
            if exist "%%~fD\bin\psql.exe" set "PSQL_EXE=%%~fD\bin\psql.exe"
        )
    )
)

if not defined PSQL_EXE (
    if defined ProgramFiles (
        for /d %%D in ("%ProgramFiles%\PostgreSQL\*") do (
            if exist "%%~fD\bin\psql.exe" set "PSQL_EXE=%%~fD\bin\psql.exe"
        )
    )
)

if not defined PSQL_EXE (
    echo [ERROR] Could not find psql.exe.
    echo   Install PostgreSQL or add PostgreSQL bin to PATH.
    echo   Common path: C:\Program Files\PostgreSQL\18\bin
    exit /b 1
)

for %%I in ("%PSQL_EXE%") do set "PG_BIN=%%~dpI"
set "CREATEDB_EXE=%PG_BIN%createdb.exe"
set "PG_RESTORE_EXE=%PG_BIN%pg_restore.exe"

if not exist "%CREATEDB_EXE%" (
    echo [ERROR] Could not find createdb.exe next to psql.exe.
    echo   Expected: %CREATEDB_EXE%
    exit /b 1
)

if not exist "%PG_RESTORE_EXE%" (
    echo [ERROR] Could not find pg_restore.exe next to psql.exe.
    echo   Expected: %PG_RESTORE_EXE%
    exit /b 1
)

exit /b 0

:check_node_tools
where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not available on PATH.
    echo   Install Node.js, then reopen PowerShell or Command Prompt.
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not available on PATH.
    echo   Install Node.js, then reopen PowerShell or Command Prompt.
    exit /b 1
)

exit /b 0

@echo off
setlocal EnableDelayedExpansion

:: Home Accounting Manager v2
:: Double-click to manage the server, database, and settings.

cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "ENV_FILE=%APP_DIR%\.env"

:: Load .env settings
call :LoadEnv

:MainMenu
cls
echo.
echo  ================================================
echo   Home Accounting - MANAGER
echo  ================================================
echo.
echo   SERVER
echo   [1]  Start Server
echo   [2]  Stop Server
echo   [3]  Restart Server
echo   [4]  Open Main App     (http://localhost:%PORT%)
echo   [4b] Open Backoffice   (http://localhost:%PORT%/backoffice)
echo   [5]  Server Status
echo.
echo   CONFIGURATION
echo   [6]  Change PostgreSQL Password
echo   [7]  Change Application Port
echo   [8]  Change JWT Secret Key
echo   [9]  Change SMTP Email Password
echo.
echo   DATABASE
echo   [10] Backup Database Now
echo   [11] Restore Database from Backup
echo   [12] Run Database Migrations
echo   [13] Initialize Fresh Database (new install)
echo.
echo   BACKUP
echo   [14] Create Full Site Backup (ZIP + Database)
echo   [19] Restore from Site Backup ZIP
echo.
echo   LOGS
echo   [15] View Server Logs (last 40 lines)
echo   [16] Clear Server Log File
echo.
echo   INFO
echo   [17] Show Current Configuration
echo.
echo   BUILD
echo   [18] Build Portable EXE (server.exe)
echo   [20] Deploy EXE to Production (copy dist\ to app root)
echo.
echo   QA / SMOKE TEST
echo   [21] Launch QA Smoke Test Menu
echo.
echo   [0]  Exit
echo.
set /p "CHOICE=  Select option: "

if /i "%CHOICE%"=="1"   goto :StartServer
if /i "%CHOICE%"=="2"   goto :StopServer
if /i "%CHOICE%"=="3"   goto :RestartServer
if /i "%CHOICE%"=="4"   goto :OpenBrowser
if /i "%CHOICE%"=="4b"  goto :OpenBackoffice
if /i "%CHOICE%"=="5"   goto :ServerStatus
if /i "%CHOICE%"=="6"   goto :ChangeDBPass
if /i "%CHOICE%"=="7"   goto :ChangePort
if /i "%CHOICE%"=="8"   goto :ChangeJWT
if /i "%CHOICE%"=="9"   goto :ChangeSMTPPass
if /i "%CHOICE%"=="10"  goto :BackupNow
if /i "%CHOICE%"=="11"  goto :RestoreDB
if /i "%CHOICE%"=="12"  goto :RunMigrations
if /i "%CHOICE%"=="13"  goto :FreshDB
if /i "%CHOICE%"=="14"  goto :SiteBackupMenu
if /i "%CHOICE%"=="15"  goto :ViewLogs
if /i "%CHOICE%"=="16"  goto :ClearLogs
if /i "%CHOICE%"=="17"  goto :ShowConfig
if /i "%CHOICE%"=="18"  goto :BuildEXE
if /i "%CHOICE%"=="19"  goto :RestoreSiteBackup
if /i "%CHOICE%"=="20"  goto :DeployEXE
if /i "%CHOICE%"=="21"  goto :LaunchQA
if /i "%CHOICE%"=="0"   goto :Done
goto :MainMenu

:: ================================================
:StartServer
cls
echo.
echo  Starting Home Accounting Server...
echo.
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [OK] Server is already running on port %PORT%
    echo      Open: http://localhost:%PORT%
    echo.
    pause
    goto :MainMenu
)
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
if exist "%APP_DIR%\server.exe" (
    echo  [Mode] Running as compiled server.exe
    start "PatientRX-Server" /MIN cmd /c "cd /d "%APP_DIR%" && server.exe >> "%APP_DIR%\logs\server.log" 2>&1"
) else (
    echo  [Mode] Running with node app.js
    start "PatientRX-Server" /MIN cmd /c "cd /d "%APP_DIR%" && node app.js >> "%APP_DIR%\logs\server.log" 2>&1"
)
echo  Waiting for server to start...
timeout /t 4 /nobreak >nul
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [OK] Server started!
    echo      Open: http://localhost:%PORT%
) else (
    echo  [!] Server may still be loading... check logs if it fails.
    echo      Option [15] to view logs.
)
echo.
pause
goto :MainMenu

:: ================================================
:StopServer
cls
echo.
echo  Stopping server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
taskkill /FI "IMAGENAME eq server.exe" /F >nul 2>&1
echo  [OK] Server stopped.
echo.
pause
goto :MainMenu

:: ================================================
:RestartServer
cls
echo.
echo  Restarting server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
taskkill /FI "IMAGENAME eq server.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul
goto :StartServer

:: ================================================
:OpenBrowser
start "" "http://localhost:%PORT%"
goto :MainMenu

:: ================================================
:OpenBackoffice
start "" "http://localhost:%PORT%/backoffice"
goto :MainMenu

:: ================================================
:ServerStatus
cls
echo.
echo  ================================================
echo   SERVER STATUS
echo  ================================================
echo.
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [RUNNING]  App is responding on port %PORT%
    echo             Open: http://localhost:%PORT%
) else (
    echo  [STOPPED]  Nothing on port %PORT%
)
echo.
echo  Checking PostgreSQL...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "\conninfo" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [RUNNING]  PostgreSQL connected  (DB: %DB_NAME%)
) else (
    echo  [ERROR]    Cannot connect to PostgreSQL
    echo             Is PostgreSQL running?
)
echo.
echo  PORT: %PORT%   DB: %DB_NAME%   HOST: %DB_HOST%
echo.
:: Log file size
if exist "%APP_DIR%\logs\server.log" (
    for %%F in ("%APP_DIR%\logs\server.log") do echo  Log size: %%~zF bytes
)
echo.
pause
goto :MainMenu

:: ================================================
:ChangeDBPass
cls
echo.
echo  ================================================
echo   CHANGE POSTGRESQL PASSWORD
echo  ================================================
echo.
echo  This will:
echo    1. Change the password in PostgreSQL
echo    2. Update .env file automatically
echo.
set /p "NEW_PASS=  Enter NEW password: "
if "%NEW_PASS%"=="" (
    echo  Cancelled.
    pause
    goto :MainMenu
)
echo.
echo  Applying changes...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "ALTER USER %DB_USER% PASSWORD '%NEW_PASS%';" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Could not connect to PostgreSQL.
    echo          Is it running? Check option [5] for status.
    pause
    goto :MainMenu
)
echo  [OK] PostgreSQL password changed.
call :UpdateEnvLine "DB_PASS" "%NEW_PASS%"
set "DB_PASS=%NEW_PASS%"
set "PGPASSWORD=%NEW_PASS%"
echo  [OK] .env file updated.
echo.
echo  Password changed successfully!
echo.
set /p "RST=  Restart server now? (Y/N): "
if /i "%RST%"=="Y" goto :RestartServer
goto :MainMenu

:: ================================================
:ChangePort
cls
echo.
echo  Current port: %PORT%
echo.
set /p "NEW_PORT=  Enter new port (e.g. 3000, 3001, 8080): "
if "%NEW_PORT%"=="" goto :MainMenu
call :UpdateEnvLine "PORT" "%NEW_PORT%"
call :UpdateEnvLine "APP_ORIGIN" "http://localhost:%NEW_PORT%"
set "PORT=%NEW_PORT%"
echo.
echo  [OK] Port changed to %NEW_PORT%
echo       Restart the server for changes to take effect.
echo.
pause
goto :MainMenu

:: ================================================
:ChangeJWT
cls
echo.
echo  ================================================
echo   CHANGE JWT SECRET KEY
echo  ================================================
echo.
echo  Warning: Changing this will log out ALL current users.
echo.
echo  [1] Enter a custom secret
echo  [2] Auto-generate a random secret (recommended)
echo.
set /p "JC=  Select: "
if "%JC%"=="2" (
    set "NEW_JWT=RXSystem_%RANDOM%%RANDOM%_SecureKey%RANDOM%_%RANDOM%"
    echo  Generated: !NEW_JWT!
) else (
    set /p "NEW_JWT=  Enter new JWT secret (min 20 characters): "
)
if "%NEW_JWT%"=="" goto :MainMenu
if "!NEW_JWT!"=="" goto :MainMenu
call :UpdateEnvLine "JWT_SECRET" "!NEW_JWT!"
echo.
echo  [OK] JWT Secret updated.
echo       Restart server for this to take effect.
echo.
pause
goto :MainMenu

:: ================================================
:ChangeSMTPPass
cls
echo.
echo  ================================================
echo   CHANGE SMTP EMAIL PASSWORD
echo  ================================================
echo.
echo  Current SMTP User:  %SMTP_USER%
echo  Current SMTP Host:  %SMTP_HOST%:%SMTP_PORT%
echo.
echo  For Gmail: use an App Password (not your regular password)
echo  Google Account > Security > 2-Step Verification > App Passwords
echo.
set /p "NEW_SMTP_PASS=  Enter SMTP password / App Password: "
if "%NEW_SMTP_PASS%"=="" (
    echo  Cancelled.
    pause
    goto :MainMenu
)
call :UpdateEnvLine "SMTP_PASS" "%NEW_SMTP_PASS%"
set "SMTP_PASS=%NEW_SMTP_PASS%"
echo.
echo  [OK] SMTP password updated in .env
echo       Restart server for changes to take effect.
echo.
set /p "RST=  Restart server now? (Y/N): "
if /i "%RST%"=="Y" goto :RestartServer
goto :MainMenu

:: ================================================
:BackupNow
cls
echo.
echo  Creating database backup...
echo.
if not exist "%APP_DIR%\backups" mkdir "%APP_DIR%\backups"

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"
set "DUMPFILE=%APP_DIR%\backups\backup_%STAMP%.dump"

set "PGPASSWORD=%DB_PASS%"
pg_dump -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -F c -f "%DUMPFILE%"
if %ERRORLEVEL% EQU 0 (
    echo.
    echo  [OK] Backup saved:
    echo       %DUMPFILE%
    echo.
    :: Show last 5 backups
    echo  Recent backups:
    for /f "tokens=*" %%F in ('dir /b /o-d "%APP_DIR%\backups\*.dump" 2^>nul') do (
        set /a _BC+=1
        if !_BC! LEQ 5 echo    - %%F
    )
) else (
    echo.
    echo  [ERROR] Backup failed. Is PostgreSQL running?
)
echo.
pause
goto :MainMenu

:: ================================================
:RestoreDB
cls
echo.
echo  ================================================
echo   RESTORE DATABASE FROM BACKUP
echo  ================================================
echo.
echo  Available backup files in backups\ folder:
echo.

set "IDX=0"
for %%F in ("%APP_DIR%\backups\*.dump") do (
    set /a IDX+=1
    echo  [!IDX!] %%~nxF
    set "DUMP_!IDX!=%%F"
)
if %IDX%==0 (
    echo  No backup files found.
    echo  Create one with option [10] first.
    echo.
    pause
    goto :MainMenu
)
echo.
set /p "DC=  Select number to restore (0 to cancel): "
if "%DC%"=="0" goto :MainMenu
if "%DC%"=="" goto :MainMenu

set "SELECTED=!DUMP_%DC%!"
if "!SELECTED!"=="" (
    echo  Invalid selection.
    pause
    goto :MainMenu
)
echo.
echo  WARNING: This will REPLACE all current data!
echo  File: !SELECTED!
echo.
set /p "CONF=  Type YES to confirm: "
if /i NOT "%CONF%"=="YES" (
    echo  Cancelled.
    pause
    goto :MainMenu
)

echo.
echo  Stopping server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Dropping and recreating database...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "DROP DATABASE IF EXISTS %DB_NAME%;" postgres
psql -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME%;" postgres
echo  Restoring data...
pg_restore -U %DB_USER% -h %DB_HOST% -d %DB_NAME% --no-owner --no-privileges "!SELECTED!"
echo.
echo  [OK] Restore complete! Starting server...
timeout /t 1 /nobreak >nul
goto :StartServer

:: ================================================
:RunMigrations
cls
echo.
echo  ================================================
echo   RUN DATABASE MIGRATIONS
echo  ================================================
echo.
echo  This applies any pending schema changes to the database.
echo  Safe to run on an existing database (only runs new migrations).
echo.
set /p "CONF=  Continue? (Y/N): "
if /i NOT "%CONF%"=="Y" goto :MainMenu
echo.
call npm run db:migrate
echo.
if %ERRORLEVEL% EQU 0 (
    echo  [OK] Migrations complete.
) else (
    echo  [ERROR] Migration failed. Check output above.
)
echo.
pause
goto :MainMenu

:: ================================================
:FreshDB
cls
echo.
echo  ================================================
echo   INITIALIZE FRESH DATABASE
echo  ================================================
echo.
echo  This creates a NEW empty database with a default admin.
echo  Use ONLY for a brand new installation.
echo  EXISTING DATA WILL BE LOST.
echo.
set /p "CONF=  Type YES to continue: "
if /i NOT "%CONF%"=="YES" goto :MainMenu
echo.
set "PGPASSWORD=%DB_PASS%"
echo  Creating database...
psql -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME%;" postgres 2>nul
echo  Installing packages...
call npm install --silent
echo  Creating tables (running migrations)...
call npm run db:migrate
echo  Creating default admin account...
call npm run db:seed
echo.
echo  [OK] Database ready!
echo       Login: admin / admin123
echo       IMPORTANT: Change the password after first login!
echo.
pause
goto :MainMenu

:: ================================================
:SiteBackupMenu
cls
echo.
echo  Creating Full Site Backup...
echo  (Application code + Database dump as one ZIP file)
echo  This may take 30-60 seconds...
echo.

if not exist "C:\RX-SiteBackups" mkdir "C:\RX-SiteBackups"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"
set "TMPFILE=C:\RX-SiteBackups\_temp_%STAMP%.dump"
set "ZIPFILE=C:\RX-SiteBackups\RX_SiteBackup_%STAMP%.zip"

echo  Step 1/2 - Saving database...
set "PGPASSWORD=%DB_PASS%"
pg_dump -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -F c -f "%TMPFILE%"
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Database dump failed. Is PostgreSQL running?
    pause
    goto :MainMenu
)

echo  Step 2/2 - Creating ZIP archive...
set "PSCMD=Add-Type -Assembly System.IO.Compression.FileSystem; $src='%APP_DIR%'; $dest='%ZIPFILE%'; $dump='%TMPFILE%'; $ex=@('node_modules','.git','logs','dist'); $files=Get-ChildItem -Path $src -Recurse -File | Where-Object { $rel=$_.FullName.Substring($src.Length+1); $parts=$rel -split '[/\\]'; $skip=$false; foreach($e in $ex){if($parts -contains $e){$skip=$true;break}}; -not $skip }; if(Test-Path $dest){Remove-Item $dest -Force}; $zip=[System.IO.Compression.ZipFile]::Open($dest,'Create'); foreach($f in $files){$e=$f.FullName.Substring($src.Length+1); try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$f.FullName,$e)|Out-Null}catch{}}; try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$dump,'db_backup.dump')|Out-Null}catch{}; $zip.Dispose(); Remove-Item $dump -Force -ErrorAction SilentlyContinue; Write-Host 'DONE'"

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "%PSCMD%"

if exist "%ZIPFILE%" (
    echo.
    echo  [OK] Backup saved to:
    echo       %ZIPFILE%
) else (
    echo.
    echo  [ERROR] ZIP creation failed.
)
echo.
pause
goto :MainMenu

:: ================================================
:ViewLogs
cls
echo.
echo  ================================================
echo   SERVER LOGS (last 50 lines)
echo  ================================================
echo.
if exist "%APP_DIR%\logs\server.log" (
    powershell -Command "Get-Content '%APP_DIR%\logs\server.log' -Tail 50"
    echo.
    for %%F in ("%APP_DIR%\logs\server.log") do echo  File size: %%~zF bytes
) else (
    echo  No log file found yet. Start the server first (option 1).
)
echo.
pause
goto :MainMenu

:: ================================================
:ClearLogs
cls
echo.
echo  ================================================
echo   CLEAR SERVER LOG FILE
echo  ================================================
echo.
if not exist "%APP_DIR%\logs\server.log" (
    echo  No log file to clear.
    pause
    goto :MainMenu
)
for %%F in ("%APP_DIR%\logs\server.log") do echo  Current size: %%~zF bytes
echo.
set /p "CONF=  Clear the log file? (Y/N): "
if /i NOT "%CONF%"=="Y" goto :MainMenu
echo. > "%APP_DIR%\logs\server.log"
echo  [OK] Log file cleared.
echo.
pause
goto :MainMenu

:: ================================================
:ShowConfig
cls
echo.
echo  ================================================
echo   CURRENT CONFIGURATION
echo  ================================================
echo.
echo  Web Server
echo  ----------
echo  Port:           %PORT%
echo  App URL:        %APP_ORIGIN%
echo  Timezone:       %TZ%
echo  Environment:    %NODE_ENV%
echo.
echo  Database
echo  ----------
echo  Host:           %DB_HOST%
echo  Database:       %DB_NAME%
echo  User:           %DB_USER%
echo  Password:       %DB_PASS:~0,3%****** (hidden)
echo.
echo  Security
echo  ----------
set "JSHORT=%JWT_SECRET:~0,6%"
echo  JWT Secret:     %JSHORT%****** (hidden)
echo.
echo  Email (SMTP)
echo  ----------
echo  SMTP Host:      %SMTP_HOST%
echo  SMTP Port:      %SMTP_PORT%
echo  SMTP User:      %SMTP_USER%
echo  From Name:      %SMTP_FROM_NAME%
if defined SMTP_PASS (
    echo  SMTP Password:  ****** (set)
) else (
    echo  SMTP Password:  (not set)
)
echo.
echo  Paths
echo  ----------
echo  App folder:     %APP_DIR%
echo  DB Backups:     %APP_DIR%\backups\
echo  Site Backups:   C:\RX-SiteBackups\
echo  Server Log:     %APP_DIR%\logs\server.log
echo.
echo  Backoffice URL: %APP_ORIGIN%/backoffice
echo.
pause
goto :MainMenu

:: ================================================
:BuildEXE
cls
echo.
echo  ================================================
echo   BUILD PORTABLE server.exe
echo  ================================================
echo.
echo  Compiles the app into a single server.exe
echo  No Node.js needed on the target machine.
echo  PostgreSQL still needs to be installed separately.
echo.
echo  Build tool:   @yao-pkg/pkg  (Node 22 LTS embedded)
echo  Build target: node22-win-x64
echo  Output:       dist\server.exe
echo.
echo  First run: binary already cached (~55 MB saved).
echo.
set /p "CONF=  Start build? (Y/N): "
if /i NOT "%CONF%"=="Y" goto :MainMenu
echo.

if not exist "%APP_DIR%\dist" mkdir "%APP_DIR%\dist"
cd /d "%APP_DIR%"

echo  Building server.exe with @yao-pkg/pkg...
echo  (Downloading Node 22 binary if first time - please wait)
echo.
call npm run build:exe
if %ERRORLEVEL% EQU 0 (
    echo.
    echo  ================================================
    echo   BUILD SUCCESSFUL
    echo  ================================================
    echo.
    echo  [OK] Executable: %APP_DIR%\dist\server.exe
    echo  [OK] Config:      %APP_DIR%\dist\.env  (auto-copied)
    echo.
    echo  Use Option [20] to deploy dist\ to the app root.
    echo  Or copy dist\server.exe + dist\.env to the target machine.
    echo.
    for %%F in ("%APP_DIR%\dist\server.exe") do echo  File size: %%~zF bytes
) else (
    echo.
    echo  [ERROR] Build failed.
    echo.
    echo  Troubleshooting:
    echo    - Make sure you have internet access (first run downloads Node binary)
    echo    - Try: npx --yes @yao-pkg/pkg --version
    echo    - Check that npm is working: npm --version
    echo    - If proxy issues, set HTTP_PROXY / HTTPS_PROXY env vars
)
echo.
pause
goto :MainMenu

:: ================================================
:DeployEXE
cls
echo.
echo  ================================================
echo   DEPLOY EXE TO PRODUCTION (app root)
echo  ================================================
echo.
echo  Copies dist\server.exe and dist\.env into the app
echo  root folder so Home-Accounting-Manager.bat [1] picks them up.
echo.
if not exist "%APP_DIR%\dist\server.exe" (
    echo  [ERROR] dist\server.exe not found.
    echo          Run option [18] to build first.
    echo.
    pause
    goto :MainMenu
)
echo  Files to copy:
for %%F in ("%APP_DIR%\dist\server.exe") do echo    server.exe  (%%~zF bytes)
echo    .env
echo.
set /p "CONF=  Deploy now? This will overwrite server.exe and .env in the app root. (Y/N): "
if /i NOT "%CONF%"=="Y" goto :MainMenu
echo.
echo  Stopping server first...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq server.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul
copy /Y "%APP_DIR%\dist\server.exe" "%APP_DIR%\server.exe" >nul
if exist "%APP_DIR%\dist\.env" copy /Y "%APP_DIR%\dist\.env" "%APP_DIR%\.env" >nul
echo  [OK] server.exe deployed.
echo  [OK] .env deployed.
echo.
set /p "RST=  Start server now? (Y/N): "
if /i "%RST%"=="Y" goto :StartServer
goto :MainMenu

:: ================================================
:RestoreSiteBackup
cls
echo.
echo  ================================================
echo   RESTORE FROM FULL SITE BACKUP ZIP
echo  ================================================
echo.
echo  This extracts the database dump from a Site Backup ZIP
echo  and restores it ??? the same as option [11] but reading
echo  the dump from inside the ZIP file.
echo.
echo  Note: Only the DATABASE is restored. Application code
echo  files inside the ZIP are NOT extracted (to preserve
echo  your current installation).
echo.

:: Determine site backup dir (default or env override)
set "SITE_BACKUP_DIR=C:\RX-SiteBackups"
if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        if "%%A"=="SITE_BACKUP_DIR" set "SITE_BACKUP_DIR=%%B"
    )
)

echo  Scanning: %SITE_BACKUP_DIR%\
echo.

set "ZIPIDX=0"
for %%F in ("%SITE_BACKUP_DIR%\*.zip") do (
    set /a ZIPIDX+=1
    echo  [!ZIPIDX!] %%~nxF
    set "ZIP_!ZIPIDX!=%%F"
)
if %ZIPIDX%==0 (
    echo  No ZIP backup files found in %SITE_BACKUP_DIR%\
    echo  Create one with option [14] first.
    echo.
    pause
    goto :MainMenu
)
echo.
set /p "ZC=  Select number to restore from (0 to cancel): "
if "%ZC%"=="0" goto :MainMenu
if "%ZC%"=="" goto :MainMenu

set "SELECTED_ZIP=!ZIP_%ZC%!"
if "!SELECTED_ZIP!"=="" (
    echo  Invalid selection.
    pause
    goto :MainMenu
)
echo.
echo  Selected: !SELECTED_ZIP!
echo.

:: Check that db_backup.dump exists inside the ZIP
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Add-Type -Assembly System.IO.Compression.FileSystem; ^
   $zip=[System.IO.Compression.ZipFile]::OpenRead('!SELECTED_ZIP!'); ^
   $entry=$zip.Entries | Where-Object { $_.Name -eq 'db_backup.dump' }; ^
   $zip.Dispose(); ^
   if($entry){ exit 0 } else { exit 1 }" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] No db_backup.dump found inside this ZIP.
    echo          This does not appear to be a valid Site Backup file.
    echo.
    pause
    goto :MainMenu
)

echo  Found db_backup.dump inside ZIP.
echo.
echo  WARNING: This will REPLACE all current database data!
echo.
set /p "CONF=  Type YES to confirm: "
if /i NOT "%CONF%"=="YES" (
    echo  Cancelled.
    pause
    goto :MainMenu
)

:: Extract db_backup.dump to a temp file
set "TMPDIR=%APP_DIR%\backups"
if not exist "%TMPDIR%" mkdir "%TMPDIR%"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"
set "TMPDUMP=%TMPDIR%\site_restore_temp_%STAMP%.dump"

echo  Extracting db_backup.dump from ZIP...
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "Add-Type -Assembly System.IO.Compression.FileSystem; ^
   $zip=[System.IO.Compression.ZipFile]::OpenRead('!SELECTED_ZIP!'); ^
   $entry=$zip.Entries | Where-Object { $_.Name -eq 'db_backup.dump' } | Select-Object -First 1; ^
   $stream=$entry.Open(); ^
   $out=[System.IO.File]::Create('!TMPDUMP!'); ^
   $stream.CopyTo($out); ^
   $out.Dispose(); $stream.Dispose(); $zip.Dispose(); ^
   Write-Host 'Extracted OK'"

if not exist "!TMPDUMP!" (
    echo  [ERROR] Extraction failed.
    pause
    goto :MainMenu
)
echo  [OK] Extracted to temp file.
echo.

echo  Stopping server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
taskkill /FI "IMAGENAME eq server.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Terminating active DB connections...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='%DB_NAME%' AND pid <> pg_backend_pid();" >nul 2>&1

echo  Dropping old database...
psql -U %DB_USER% -h %DB_HOST% -d postgres -c "DROP DATABASE IF EXISTS "%DB_NAME%";"

echo  Creating fresh database...
psql -U %DB_USER% -h %DB_HOST% -d postgres -c "CREATE DATABASE "%DB_NAME%" TEMPLATE template0;"

echo  Restoring data from Site Backup...
pg_restore -U %DB_USER% -h %DB_HOST% -d %DB_NAME% --no-owner --no-privileges "!TMPDUMP!"
set "RESTORE_ERR=%ERRORLEVEL%"

echo  Cleaning up temp file...
del /Q "!TMPDUMP!" >nul 2>&1

if %RESTORE_ERR% EQU 0 (
    echo.
    echo  ================================================
    echo   RESTORE SUCCESSFUL
    echo  ================================================
    echo.
    echo  All data from the Site Backup has been restored.
    echo  Starting server...
    echo.
    timeout /t 1 /nobreak >nul
    goto :StartServer
) else (
    echo.
    echo  [WARNING] pg_restore finished with warnings or errors.
    echo  Some data may not have been restored correctly.
    echo  Check the output above for details.
    echo.
    set /p "RST=  Start server anyway? (Y/N): "
    if /i "!RST!"=="Y" goto :StartServer
    goto :MainMenu
)

:: ================================================
:Done
exit /b 0

:: ================================================
:: HELPER: Check if something is on the configured port
:CheckPort
set "PORT_IN_USE=0"
powershell -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PORT_IN_USE=1"
goto :eof

:: ================================================
:: HELPER: Load .env into variables
:LoadEnv
set "PORT=3000"
set "DB_USER=postgres"
set "DB_PASS="
set "DB_NAME=home_accounting_dev"
set "DB_HOST=127.0.0.1"
set "JWT_SECRET="
set "TZ=America/New_York"
set "SMTP_HOST=smtp.gmail.com"
set "SMTP_PORT=587"
set "SMTP_USER="
set "SMTP_PASS="
set "SMTP_FROM_NAME=Home Accounting"
set "APP_ORIGIN=http://localhost:3000"
set "NODE_ENV=production"
if not exist "%ENV_FILE%" goto :eof
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "_K=%%A"
    set "_V=%%B"
    echo !_K! | findstr /B "#" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        if "!_K!"=="PORT"           set "PORT=!_V!"
        if "!_K!"=="DB_USER"        set "DB_USER=!_V!"
        if "!_K!"=="DB_PASS"        set "DB_PASS=!_V!"
        if "!_K!"=="DB_NAME"        set "DB_NAME=!_V!"
        if "!_K!"=="DB_HOST"        set "DB_HOST=!_V!"
        if "!_K!"=="JWT_SECRET"     set "JWT_SECRET=!_V!"
        if "!_K!"=="TZ"             set "TZ=!_V!"
        if "!_K!"=="SMTP_HOST"      set "SMTP_HOST=!_V!"
        if "!_K!"=="SMTP_PORT"      set "SMTP_PORT=!_V!"
        if "!_K!"=="SMTP_USER"      set "SMTP_USER=!_V!"
        if "!_K!"=="SMTP_PASS"      set "SMTP_PASS=!_V!"
        if "!_K!"=="SMTP_FROM_NAME" set "SMTP_FROM_NAME=!_V!"
        if "!_K!"=="APP_ORIGIN"     set "APP_ORIGIN=!_V!"
        if "!_K!"=="NODE_ENV"       set "NODE_ENV=!_V!"
    )
)
set "PGPASSWORD=%DB_PASS%"
goto :eof

:: ================================================
:LaunchQA
cls
echo.
echo  ================================================
echo   QA SMOKE TEST SUITE
echo  ================================================
echo.
echo  Launches the standalone QA smoke test menu.
echo  Tests run against a SEPARATE QA database (patient_rx_qa).
echo  The production database is NOT touched.
echo.
echo  First time? Choose option [1] in the QA menu to
echo  install playwright-core (used by the smoke test).
echo.
if not exist "%APP_DIR%\qa\qa-menu.bat" (
    echo  [ERROR] qa\ folder not found in %APP_DIR%
    echo          Make sure the QA folder was copied alongside the app.
    echo.
    pause
    goto :MainMenu
)
echo  Opening QA menu...
echo.
call "%APP_DIR%\qa\qa-menu.bat"
goto :MainMenu

:: ================================================
:: HELPER: Update one key=value line in .env
:UpdateEnvLine
set "_KEY=%~1"
set "_VAL=%~2"
set "_TMP=%ENV_FILE%.tmp"
if exist "%_TMP%" del /Q "%_TMP%"
set "_FOUND=0"
for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
    set "_LINE=%%L"
    echo !_LINE! | findstr /B /C:"!_KEY!=" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo !_KEY!=!_VAL!>>"%_TMP%"
        set "_FOUND=1"
    ) else (
        echo !_LINE!>>"%_TMP%"
    )
)
:: If key didn't exist, append it
if "!_FOUND!"=="0" echo !_KEY!=!_VAL!>>"%_TMP%"
move /Y "%_TMP%" "%ENV_FILE%" >nul
goto :eof


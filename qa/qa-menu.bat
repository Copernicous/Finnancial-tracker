@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

:menu
cls
echo ================================================================
echo Home Accounting - QA Smoke Test Menu
echo ================================================================
echo.
echo This menu runs standalone QA scripts from the qa\ folder.
echo It does NOT embed Playwright into the production app runtime.
echo.
echo Recommended first run:
echo   1) Install/verify QA dependency
echo   2) Start local QA site
echo   3) Seed fake QA data
echo   4) Seed additional data (optional)
echo.
echo Current default URL: https://localhost:3443
echo Current default QA DB: patient_rx_qa
echo.
echo [1] Install/verify QA dependency
echo [2] Start local QA site on HTTPS
echo [3] Seed fake QA data
echo [4] Add more fake QA data
echo [5] Run patient import workflow simulation
echo [6] Run smoke test - headless/fast
echo [7] Run smoke test - visible browser
echo [8] Check QA status
echo [9] View last smoke result
echo [L] View QA logs
echo [S] Stop local QA site
echo [W] Open QA web dashboard
echo [0] Exit
echo.
choice /c 123456789LSW0 /n /m "Select an option: "
set choice=%errorlevel%

if "%choice%"=="13" goto end
if "%choice%"=="12" goto web
if "%choice%"=="11" goto stop
if "%choice%"=="9" goto result
if "%choice%"=="8" goto status
if "%choice%"=="10" goto logs
if "%choice%"=="6" goto smoke_headless
if "%choice%"=="7" goto smoke_visible
if "%choice%"=="5" goto import_sim
if "%choice%"=="4" goto seed_append
if "%choice%"=="3" goto seed
if "%choice%"=="2" goto start
if "%choice%"=="1" goto install
goto menu

:install
cls
echo Installing/verifying Playwright Core as a dev dependency.
echo This keeps the QA browser library in this project, not in TEMP.
echo Browser binaries are not downloaded; the smoke test uses installed Chrome.
echo.
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --save-dev playwright-core --no-audit --no-fund
echo.
pause
goto menu

:start
cls
echo Starting local QA site:
echo   Browser URL: https://localhost:3443
echo   Backend:     http://localhost:3001
echo   Database:    QA_DB_NAME from qa\.env.qa or patient_rx_qa
echo.
echo A self-signed localhost certificate may be generated under qa\certs.
echo.
node qa\start-local-qa.js
echo.
pause
goto menu

:seed
cls
echo Seeding fake QA data.
echo.
echo This creates/updates:
echo   - admin QA login
echo   - QA Patient
echo   - QA RX record
echo   - QA Pharmacy / Clinic / Transport / Workflow / Medication records
echo.
echo Safety:
echo   The script refuses non-QA database names unless QA_ALLOW_NON_QA_DB=true.
echo.
node qa\seed-qa-data.js
echo.
pause
goto menu

:seed_append
cls
echo Adding another unique batch of fake QA data.
echo.
echo This creates new QA records instead of updating the baseline records.
echo Smoke tests still use the stable baseline records, but the QA app will
echo show additional QA patients/RX/catalog data for manual testing.
echo.
set QA_SEED_APPEND=true
node qa\seed-qa-data.js
set QA_SEED_APPEND=
echo.
pause
goto menu

:import_sim
cls
echo Running patient import workflow simulation.
echo.
echo This prints sample import outcomes for the 3 requested scenarios:
echo   1) all workflow steps on same date
echo   2) daily step progression
echo   3) service date inferred from workflow history
echo.
node scripts/simulate-patient-workflow-import.js
echo.
pause
goto menu

:smoke_headless
cls
echo Running headless smoke test.
echo.
echo This opens Chrome invisibly, logs in, clicks safe pages/buttons,
echo and writes qa\results\smoke-report.json.
echo.
set QA_HEADLESS=true
set QA_SLOW_MO=0
node qa\smoke-qa.js
echo.
pause
goto menu

:smoke_visible
cls
echo Running visible browser smoke test.
echo.
echo Chrome will open so you can watch the automated clicks.
echo This is slower and useful for debugging.
echo.
set QA_HEADLESS=false
set QA_SLOW_MO=300
node qa\smoke-qa.js
echo.
pause
goto menu

:status
cls
echo Checking QA URL, ports, PID files, and last smoke result.
echo.
node qa\status.js
echo.
pause
goto menu

:result
cls
echo Last smoke result summary.
echo.
node qa\view-last-result.js
echo.
echo Full JSON report:
echo   qa\results\smoke-report.json
echo.
pause
goto menu

:logs
cls
echo QA logs
echo ================================================================
echo.
echo [Backend log - last 120 lines]
powershell -NoProfile -Command "if (Test-Path 'qa\logs\backend.log') { Get-Content 'qa\logs\backend.log' -Tail 120 } else { 'No backend log yet.' }"
echo.
echo [HTTPS proxy log - last 80 lines]
powershell -NoProfile -Command "if (Test-Path 'qa\logs\https-proxy.log') { Get-Content 'qa\logs\https-proxy.log' -Tail 80 } else { 'No proxy log yet.' }"
echo.
pause
goto menu

:stop
cls
echo Stopping only QA processes started by qa\start-local-qa.js.
echo Production/manual processes are not stopped unless their PID is in qa\pids.
echo.
node qa\stop-local-qa.js
echo.
pause
goto menu

:web
cls
echo Starting QA web dashboard.
echo.
echo Open this URL:
echo   http://127.0.0.1:3200
echo.
echo The dashboard has no password and is localhost-only by default.
echo Close this window or press Ctrl+C to stop the dashboard.
echo.
start "" http://127.0.0.1:3200
node qa\web-ui.js
echo.
pause
goto menu

:end
endlocal


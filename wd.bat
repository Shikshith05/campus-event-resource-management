@echo off
setlocal
cd /d "%~dp0"
title CERMS (without Docker)

rem Runs CERMS against PostgreSQL 16 in WSL and MongoDB installed on Windows.
rem Usage: wd.bat          start the app (builds the database on first run)
rem        wd.bat setup    rebuild the PostgreSQL database first (deletes its data)

where wsl >nul 2>&1
if errorlevel 1 (
  echo ERROR: WSL with PostgreSQL 16 is required.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20.9 or newer is required.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is required. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

where mongosh >nul 2>&1
if errorlevel 1 (
  echo ERROR: MongoDB 8 and mongosh are required.
  pause
  exit /b 1
)

if exist "app\.env.local" goto env_ready
echo Creating app\.env.local with a random local session secret...
node -e "const fs=require('fs');const crypto=require('crypto');const p='app/.env.example';const marker='SESSION_SECRET=replace-with-a-long-random-development-secret';const config=fs.readFileSync(p,'utf8');if(!config.includes(marker)){console.error('Could not find SESSION_SECRET placeholder in app/.env.example');process.exit(1)}fs.writeFileSync('app/.env.local',config.replace(marker,'SESSION_SECRET='+crypto.randomBytes(48).toString('base64')));"
if errorlevel 1 (
  echo ERROR: Could not create app\.env.local.
  pause
  exit /b 1
)

:env_ready
echo Starting PostgreSQL in WSL...
wsl -u root -- service postgresql start >nul
rem WSL shuts down when idle, which stops PostgreSQL; keep it awake.
start "CERMS WSL keep-alive (close after stopping the app)" /min wsl -- sleep infinity

set /a WAIT_SECONDS=0
:wait_postgres
wsl -- pg_isready -h localhost -q
if not errorlevel 1 goto postgres_ready
set /a WAIT_SECONDS+=1
if %WAIT_SECONDS% GEQ 60 (
  echo ERROR: PostgreSQL in WSL did not become ready within 60 seconds.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_postgres

:postgres_ready
if /i "%~1"=="setup" goto setup_postgres
wsl -- env PGPASSWORD=cerms_app_dev psql -h localhost -U cerms_app -d cerms -tAc "select 1" >nul 2>&1
if not errorlevel 1 goto database_ready
echo The cerms database is not set up yet.

:setup_postgres
for /f "usebackq delims=" %%P in (`wsl --exec wslpath -a "%CD%"`) do set "WSL_ROOT=%%P"
wsl -- bash "%WSL_ROOT%/scripts/setup-postgres-wsl.sh"
if errorlevel 1 (
  echo ERROR: PostgreSQL setup failed.
  pause
  exit /b 1
)

:database_ready
echo Checking MongoDB...
mongosh --quiet "mongodb://127.0.0.1:27017/cerms" --eval "db.runCommand({ping:1})" >nul 2>&1
if not errorlevel 1 goto mongodb_ready
net start MongoDB >nul 2>&1
mongosh --quiet "mongodb://127.0.0.1:27017/cerms" --eval "db.runCommand({ping:1})" >nul 2>&1
if errorlevel 1 (
  echo ERROR: MongoDB is not running. Start the MongoDB service, then retry.
  pause
  exit /b 1
)

:mongodb_ready
echo Loading approval workflow templates and demo workflows...
mongosh --quiet "mongodb://127.0.0.1:27017/cerms" db/mongo/load.js
if errorlevel 1 (
  echo ERROR: Could not load MongoDB workflow templates.
  pause
  exit /b 1
)
mongosh --quiet "mongodb://127.0.0.1:27017/cerms" db/mongo/seed_demo_workflows.js
if errorlevel 1 (
  echo ERROR: Could not load MongoDB demo workflows.
  pause
  exit /b 1
)

if exist "app\node_modules" goto dependencies_ready
echo Installing the web app dependencies...
pushd app
call npm install
if errorlevel 1 (
  popd
  echo ERROR: npm install failed.
  pause
  exit /b 1
)
popd

:dependencies_ready
echo.
echo CERMS is starting at http://localhost:3000/login
echo Keep this window open while you use the app. Press Ctrl+C to stop the web server.
echo.
set "DATABASE_URL=postgresql://cerms_app:cerms_app_dev@localhost:5432/cerms"
set "MONGODB_URI=mongodb://127.0.0.1:27017/cerms"
pushd app
call npm run dev
set "APP_EXIT=%ERRORLEVEL%"
popd
exit /b %APP_EXIT%

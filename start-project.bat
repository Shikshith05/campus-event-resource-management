@echo off
setlocal
cd /d "%~dp0"
title CERMS - Campus Event and Resource Management System

where docker >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker Desktop and the Docker CLI are required.
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

docker version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker Desktop is not ready. Start Docker Desktop, wait for it to show Running, then retry.
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
echo Starting PostgreSQL and MongoDB...
docker compose up -d
if errorlevel 1 (
  echo ERROR: Docker Compose could not start the databases.
  pause
  exit /b 1
)

echo Waiting for PostgreSQL...
set /a WAIT_SECONDS=0
:wait_postgres
docker compose exec -T postgres pg_isready -h 127.0.0.1 -U cerms -d cerms >nul 2>&1
if not errorlevel 1 goto postgres_ready
set /a WAIT_SECONDS+=1
if %WAIT_SECONDS% GEQ 120 goto postgres_timeout
timeout /t 1 /nobreak >nul
goto wait_postgres

:postgres_timeout
echo ERROR: PostgreSQL did not become ready within 120 seconds.
docker compose logs postgres
pause
exit /b 1

:postgres_ready
echo Waiting for MongoDB...
set /a WAIT_SECONDS=0
:wait_mongodb
docker compose exec -T mongodb mongosh --quiet "mongodb://localhost:27017/cerms" --eval "db.runCommand({ping:1})" >nul 2>&1
if not errorlevel 1 goto mongodb_ready
set /a WAIT_SECONDS+=1
if %WAIT_SECONDS% GEQ 120 goto mongodb_timeout
timeout /t 1 /nobreak >nul
goto wait_mongodb

:mongodb_timeout
echo ERROR: MongoDB did not become ready within 120 seconds.
docker compose logs mongodb
pause
exit /b 1

:mongodb_ready
echo Loading approval workflow templates and demo workflows...
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js
if errorlevel 1 (
  echo ERROR: Could not load MongoDB workflow templates.
  pause
  exit /b 1
)
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/seed_demo_workflows.js
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
set "DATABASE_URL=postgresql://cerms_app:cerms_app_dev@127.0.0.1:5433/cerms"
set "MONGODB_URI=mongodb://127.0.0.1:27017/cerms"
pushd app
call npm run dev
set "APP_EXIT=%ERRORLEVEL%"
popd
exit /b %APP_EXIT%

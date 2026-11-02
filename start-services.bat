@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   CareerAtlas - starting all local services
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [WARN] .env not found, copying .env.example
  copy /y ".env.example" ".env" >nul
)

echo [1/4] Starting PostgreSQL and Redis...
docker compose up -d --wait
if errorlevel 1 (
  echo [ERROR] Failed to start Docker services.
  pause
  exit /b 1
)

echo [2/4] Applying database migrations...
call npm run db:migrate
if errorlevel 1 (
  echo [ERROR] Database migration failed.
  pause
  exit /b 1
)

echo [3/4] Validating environment...
call npm run validate:env
if errorlevel 1 (
  echo [ERROR] Environment validation failed.
  pause
  exit /b 1
)

echo [4/4] Starting web and worker...
start "CareerAtlas Web" cmd /k "cd /d ""%~dp0"" && npm run dev"
start "CareerAtlas Worker" cmd /k "cd /d ""%~dp0"" && npm run worker"

echo.
echo All services started.
echo   Web    -^> http://localhost:3000
echo   Worker -^> separate window
echo   Docker -^> postgres:5433, redis:6380
echo.
echo Stop infrastructure later with: docker compose down
pause

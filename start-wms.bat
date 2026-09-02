@echo off
title WMS Launcher
chcp 65001 >nul

set "ROOT=%~dp0"
set "WMS_DIR=%ROOT%wms"
set "FE_DIR=%WMS_DIR%\wms-frontend"

echo ========================================
echo   WMS - Starting Backend and Frontend
echo ========================================
echo.

for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  echo Stopping old process on port 3000, PID %%a
  taskkill /F /PID %%a /T >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
  echo Stopping old process on port 5173, PID %%a
  taskkill /F /PID %%a /T >nul 2>&1
)
timeout /t 1 /nobreak >nul

start "WMS Backend" cmd /k call "%WMS_DIR%\run-backend-dev.bat"
start "WMS Frontend" cmd /k call "%FE_DIR%\run-frontend-dev.bat"

echo Waiting for backend on http://localhost:3000 ...
set /a tries=0
:wait_backend
timeout /t 2 /nobreak >nul
set /a tries+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 3).StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto backend_ok
if %tries% lss 20 goto wait_backend
echo WARNING: Backend did not respond - check WMS Backend window for errors.
:backend_ok

echo.
echo Backend  : http://localhost:3000
echo Frontend : http://localhost:5173
echo.
echo Dev mode: NODE_ENV=development
echo Two windows should open: WMS Backend and WMS Frontend
echo.
pause

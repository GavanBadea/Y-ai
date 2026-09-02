@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

:: Y-ai WMS Launcher - start server, wait for API, open browser

set "PORT=3000"
call :resolve_install_root
set "LOG=%APP_ROOT%launcher.log"
call :resolve_node
if errorlevel 1 exit /b 1
call :resolve_python

set "DATA_DIR=%APP_ROOT%data"
set "UPLOADS_BASE=%APP_ROOT%uploads"
set "BACKUPS_BASE=%APP_ROOT%backups"
if not exist "%DATA_DIR%"     md "%DATA_DIR%"
if not exist "%UPLOADS_BASE%" md "%UPLOADS_BASE%"
if not exist "%BACKUPS_BASE%" md "%BACKUPS_BASE%"

set "DB_PATH=%DATA_DIR%\warehouse.db"
set "UPLOADS_PATH=%UPLOADS_BASE%"
set "BACKUP_PATH=%BACKUPS_BASE%"
set "LICENSE_FILE=%DATA_DIR%\license.dat"

if not defined OLLAMA_URL set "OLLAMA_URL=http://127.0.0.1:11434"
if not defined OLLAMA_MODEL set "OLLAMA_MODEL=qwen2:1.5b"
if not defined OLLAMA_KEEP_ALIVE set "OLLAMA_KEEP_ALIVE=30m"
if not defined OLLAMA_NUM_PREDICT set "OLLAMA_NUM_PREDICT=160"
if not defined OLLAMA_NUM_CTX set "OLLAMA_NUM_CTX=1024"
if not defined OLLAMA_TEMPERATURE set "OLLAMA_TEMPERATURE=0.35"
if not defined OLLAMA_CHAT_TIMEOUT set "OLLAMA_CHAT_TIMEOUT=90"

echo [%DATE% %TIME%] Launcher started >> "%LOG%"
echo [%DATE% %TIME%] APP_ROOT=%APP_ROOT% >> "%LOG%"
echo [%DATE% %TIME%] NODE_EXE=%NODE_EXE% >> "%LOG%"

if not exist "%APP_DIR%\server.js" (
    echo [%DATE% %TIME%] ERROR: server.js not found in %APP_DIR% >> "%LOG%"
    msg * "Application files missing. Run launcher.bat from the Y-ai-WMS install folder."
    exit /b 1
)

set "API_OK=0"
call :check_api
if "!API_OK!"=="1" (
    echo [%DATE% %TIME%] Server already responding on port %PORT% >> "%LOG%"
    call :open_browser
    exit /b 0
)

if exist "%APP_ROOT%stop.bat" (
    echo [%DATE% %TIME%] Stopping stale process on port %PORT% >> "%LOG%"
    call "%APP_ROOT%stop.bat" >> "%LOG%" 2>&1
    ping -n 2 127.0.0.1 >nul 2>&1
)

call :setup_firewall

echo [%DATE% %TIME%] Running init-db.js >> "%LOG%"
set "NODE_ENV=production"
set "PATH=%APP_ROOT%runtime\node;%PATH%"
"%NODE_EXE%" "%APP_DIR%\init-db.js" >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%DATE% %TIME%] init-db FAILED >> "%LOG%"
    msg * "Database init failed. See launcher.log in the install folder."
    exit /b 1
)

echo [%DATE% %TIME%] Starting server... >> "%LOG%"
start "Y-ai-Server" /min cmd /c "cd /d ""%APP_DIR%"" && set NODE_ENV=production && set PORT=%PORT% && set DB_PATH=%DB_PATH% && set LICENSE_FILE=%LICENSE_FILE% && set UPLOADS_PATH=%UPLOADS_PATH% && set BACKUP_PATH=%BACKUP_PATH% && set PYTHON_EXE=%PYTHON_EXE% && set WMS_BACKEND_URL=http://127.0.0.1:%PORT% && set OLLAMA_URL=%OLLAMA_URL% && set OLLAMA_MODEL=%OLLAMA_MODEL% && set OLLAMA_KEEP_ALIVE=%OLLAMA_KEEP_ALIVE% && set OLLAMA_NUM_PREDICT=%OLLAMA_NUM_PREDICT% && set OLLAMA_NUM_CTX=%OLLAMA_NUM_CTX% && set OLLAMA_TEMPERATURE=%OLLAMA_TEMPERATURE% && set OLLAMA_CHAT_TIMEOUT=%OLLAMA_CHAT_TIMEOUT% && ""%NODE_EXE%"" server.js >> ""%LOG%"" 2>&1"

set /a WAIT_ATTEMPTS=0
:wait_for_server
call :check_api
if "!API_OK!"=="1" goto server_ready
set /a WAIT_ATTEMPTS+=1
if !WAIT_ATTEMPTS! geq 45 (
    echo [%DATE% %TIME%] Server API not ready within 90s >> "%LOG%"
    msg * "Server failed to start. Check launcher.log in the install folder."
    exit /b 1
)
ping -n 2 127.0.0.1 >nul 2>&1
goto wait_for_server

:server_ready
echo [%DATE% %TIME%] Server API ready on port %PORT% >> "%LOG%"
call :open_browser
exit /b 0

:resolve_install_root
set "APP_ROOT=%~dp0"
set "APP_DIR=%APP_ROOT%app"
if exist "%APP_DIR%\server.js" exit /b 0

if exist "%LOCALAPPDATA%\Y-ai-WMS\app\server.js" (
    set "APP_ROOT=%LOCALAPPDATA%\Y-ai-WMS\"
    set "APP_DIR=%APP_ROOT%app"
    exit /b 0
)

if exist "C:\Program Files\Y-ai-WMS\app\server.js" (
    set "APP_ROOT=C:\Program Files\Y-ai-WMS\"
    set "APP_DIR=%APP_ROOT%app"
    exit /b 0
)

if exist "C:\Program Files (x86)\Y-ai-WMS\app\server.js" (
    set "APP_ROOT=C:\Program Files (x86)\Y-ai-WMS\"
    set "APP_DIR=%APP_ROOT%app"
    exit /b 0
)
exit /b 0

:resolve_node
set "NODE_EXE=%APP_ROOT%runtime\node\node.exe"
if exist "%NODE_EXE%" exit /b 0

if exist "%LOCALAPPDATA%\Y-ai-WMS\runtime\node\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Y-ai-WMS\runtime\node\node.exe"
    exit /b 0
)

where node >nul 2>&1
if not errorlevel 1 (
    set "NODE_EXE=node"
    echo [%DATE% %TIME%] Using system Node.js from PATH >> "%LOG%"
    exit /b 0
)

echo [%DATE% %TIME%] ERROR: node.exe not found at %APP_ROOT%runtime\node\ >> "%LOG%"
msg * "Node.js not found. Run launcher.bat from the Y-ai-WMS folder, or reinstall. Expected: runtime\node\node.exe"
exit /b 1

:resolve_python
set "PYTHON_EXE=%APP_ROOT%runtime\python\python.exe"
if exist "%PYTHON_EXE%" exit /b 0

if exist "%LOCALAPPDATA%\Y-ai-WMS\runtime\python\python.exe" (
    set "PYTHON_EXE=%LOCALAPPDATA%\Y-ai-WMS\runtime\python\python.exe"
    exit /b 0
)

where python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=python"
    exit /b 0
)
exit /b 0

:open_browser
start "" "http://localhost:%PORT%/login"
echo [%DATE% %TIME%] Browser opened >> "%LOG%"
exit /b 0

:check_api
set "API_OK=0"
powershell -NoProfile -Command "try { $h = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 3; if ($h.StatusCode -ne 200) { exit 1 }; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "API_OK=1"
exit /b 0

:setup_firewall
netsh advfirewall firewall show rule name="Y-ai WMS TCP 3000" >nul 2>&1
if not errorlevel 1 exit /b 0
netsh advfirewall firewall add rule name="Y-ai WMS TCP 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] Firewall: run allow-network.bat as admin for LAN access >> "%LOG%"
)
netsh advfirewall firewall show rule name="Y-ai WMS TCP 3001" >nul 2>&1
if not errorlevel 1 exit /b 0
netsh advfirewall firewall add rule name="Y-ai WMS TCP 3001" dir=in action=allow protocol=TCP localport=3001 profile=private,domain >> "%LOG%" 2>&1
exit /b 0

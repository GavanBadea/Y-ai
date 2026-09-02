@echo off
chcp 65001 >nul
setlocal
:: build-installer.bat -- Y-ai WMS v2.5.3

cd /d "%~dp0"
set "PKG_DIR=%CD%"
set "SRC_DIR=%PKG_DIR%\..\wms"
set "DIST_DIR=%PKG_DIR%\dist"
set "OUT_DIR=%PKG_DIR%\output"
set "LOG=%PKG_DIR%\build.log"
echo. > "%LOG%"
echo BUILD START: %DATE% %TIME% >> "%LOG%"
echo.
echo ================================================
echo   Y-ai WMS v2.5.3 -- Building Installer
echo ================================================
echo.
:: ----------------------------------------------------------
:: Step 0: Check source project exists
:: ----------------------------------------------------------
echo [0/8] Checking project folder...
if not exist "%SRC_DIR%" (
    echo ERROR: Project not found at:
    echo   %SRC_DIR%
    echo.
    pause
    exit /b 1
)
echo   OK - Project found
:: ----------------------------------------------------------
:: Step 1: Check Node.js
:: ----------------------------------------------------------
echo.
echo [1/8] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo   Download from: https://nodejs.org
    pause
    exit /b 1
)
node --version
echo   OK - Node.js found
:: ----------------------------------------------------------
:: Step 2: Prepare dist folder
:: ----------------------------------------------------------
echo.
echo [2/8] Preparing dist folder...
if exist "%DIST_DIR%" (
    echo   Removing old dist...
    rd /s /q "%DIST_DIR%" 2>>"%LOG%"
)
mkdir "%DIST_DIR%"
mkdir "%DIST_DIR%\app"
mkdir "%DIST_DIR%\runtime"
mkdir "%DIST_DIR%\app\uploads"
mkdir "%DIST_DIR%\app\backups"
echo   OK - dist folder ready
:: ----------------------------------------------------------
:: Step 3: Build React Frontend
:: ----------------------------------------------------------
echo.
echo [3/8] Building React frontend (this may take 1-2 min)...
cd /d "%SRC_DIR%\wms-frontend"
echo   Running: npm install...
call npm install --silent 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo ERROR: npm install failed. See build.log
    pause
    exit /b 1
)
echo   Running: npm run build...
call npm run build 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo ERROR: npm run build failed. See build.log
    pause
    exit /b 1
)
if not exist "%SRC_DIR%\wms-frontend\dist\index.html" (
    echo ERROR: Build did not produce index.html
    pause
    exit /b 1
)
echo   OK - Frontend built
:: ----------------------------------------------------------
:: Step 4: Install backend packages
:: ----------------------------------------------------------
echo.
echo [4/8] Installing backend packages (npm install)...
cd /d "%SRC_DIR%"
call npm install --omit=dev --silent 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo ERROR: Backend npm install failed. See build.log
    pause
    exit /b 1
)
echo   OK - Backend packages ready
:: ----------------------------------------------------------
:: Step 5: Copy app files
:: ----------------------------------------------------------
echo.
echo [5/8] Copying app files...
echo   Copying: controllers...
xcopy /e /i /q "%SRC_DIR%\controllers"  "%DIST_DIR%\app\controllers"  >nul 2>>"%LOG%"
echo   Copying: middleware...
xcopy /e /i /q "%SRC_DIR%\middleware"   "%DIST_DIR%\app\middleware"   >nul 2>>"%LOG%"
echo   Copying: routes...
xcopy /e /i /q "%SRC_DIR%\routes"       "%DIST_DIR%\app\routes"       >nul 2>>"%LOG%"
echo   Copying: utils...
xcopy /e /i /q "%SRC_DIR%\utils"        "%DIST_DIR%\app\utils"        >nul 2>>"%LOG%"
if exist "%SRC_DIR%\migrations" (
    xcopy /e /i /q "%SRC_DIR%\migrations" "%DIST_DIR%\app\migrations" >nul 2>>"%LOG%"
)
echo   Copying node_modules - about 100-200 MB, please wait...
xcopy /e /i /q "%SRC_DIR%\node_modules" "%DIST_DIR%\app\node_modules" >nul 2>>"%LOG%"
echo   Copying: frontend dist...
xcopy /e /i /q "%SRC_DIR%\wms-frontend\dist" "%DIST_DIR%\app\wms-frontend\dist" >nul 2>>"%LOG%"
echo   Copying: root files...
for %%f in (server.js db.js license.js init-db.js Y-ai.py requirements-yai.txt package.json version.json ecosystem.config.cjs) do (
    if exist "%SRC_DIR%\%%f" (
        copy /y "%SRC_DIR%\%%f" "%DIST_DIR%\app\%%f" >nul 2>>"%LOG%"
    )
)
echo   Creating .env for production...
set "JWT_SECRET="
node -e "require('fs').writeFileSync(process.argv[1], require('crypto').randomBytes(32).toString('hex'))" "%DIST_DIR%\app\.jwt.tmp" 2>>"%LOG%"
if exist "%DIST_DIR%\app\.jwt.tmp" set /p JWT_SECRET=<"%DIST_DIR%\app\.jwt.tmp"
if exist "%DIST_DIR%\app\.jwt.tmp" del /f /q "%DIST_DIR%\app\.jwt.tmp" 2>nul
if not defined JWT_SECRET (
    echo ERROR: Failed to generate JWT_SECRET. See build.log
    pause
    exit /b 1
)
(
    echo PORT=3000
    echo DB_PATH=../data/warehouse.db
    echo LICENSE_FILE=../data/license.dat
    echo UPLOADS_PATH=../uploads
    echo BACKUP_PATH=../backups
    echo JWT_SECRET=%JWT_SECRET%
    echo NODE_ENV=production
    echo.
    echo # Y-ai / Ollama — جهاز العميل ^(ثبّت Ollama ثم: ollama pull qwen2:1.5b^)
    echo OLLAMA_URL=http://127.0.0.1:11434
    echo OLLAMA_MODEL=qwen2:1.5b
    echo OLLAMA_KEEP_ALIVE=30m
    echo OLLAMA_NUM_PREDICT=160
    echo OLLAMA_NUM_CTX=1024
    echo OLLAMA_TEMPERATURE=0.35
    echo OLLAMA_CHAT_TIMEOUT=90
    echo.
    echo # فحص التحديثات من GitHub
    echo UPDATE_MANIFEST_URL=https://raw.githubusercontent.com/GavanBadea/Y-ai/main/version.json
) > "%DIST_DIR%\app\.env"
node -e "const fs=require('fs');const p=process.argv[1];const m=fs.readFileSync(p,'utf8').match(/^JWT_SECRET=(.*)$/m);if(!m||!String(m[1]).trim())process.exit(1)" "%DIST_DIR%\app\.env" 2>>"%LOG%"
if errorlevel 1 (
    echo ERROR: .env has empty JWT_SECRET
    pause
    exit /b 1
)
echo   OK - App files copied
:: ----------------------------------------------------------
:: Step 5b: Obfuscate backend + frontend (production protection)
:: ----------------------------------------------------------
echo.
echo [5b/8] Obfuscating application code (may take 2-5 min)...
cd /d "%PKG_DIR%"
if not exist "%PKG_DIR%\node_modules\javascript-obfuscator" (
    echo   Installing obfuscation tools...
    call npm install --silent 2>>"%LOG%"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install javascript-obfuscator. See build.log
        pause
        exit /b 1
    )
)
node "%PKG_DIR%\scripts\obfuscate-dist.js" "%DIST_DIR%\app" >> "%LOG%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Obfuscation failed. See build.log
    pause
    exit /b 1
)
echo   OK - Application code protected
:: ----------------------------------------------------------
:: Step 5c: Ensure clean database template for first install
:: ----------------------------------------------------------
echo.
echo [5c/8] Preparing clean database template...
cd /d "%SRC_DIR%"
if exist "%SRC_DIR%\warehouse_template.db" (
    copy /y "%SRC_DIR%\warehouse_template.db" "%DIST_DIR%\warehouse_template.db" >nul 2>>"%LOG%"
    echo   OK - warehouse_template.db copied
) else if exist "%SRC_DIR%\warehouse.db" (
    node "%SRC_DIR%\create-template-db.js" >> "%LOG%" 2>&1
    if exist "%SRC_DIR%\warehouse_template.db" (
        copy /y "%SRC_DIR%\warehouse_template.db" "%DIST_DIR%\warehouse_template.db" >nul 2>>"%LOG%"
        echo   OK - warehouse_template.db generated
    ) else (
        echo ERROR: Could not create warehouse_template.db
        pause
        exit /b 1
    )
) else (
    echo ERROR: No warehouse.db found - reset the app before building
    pause
    exit /b 1
)
:: ----------------------------------------------------------
:: Step 6: Download Node.js Portable
:: ----------------------------------------------------------
echo.
echo [6/8] Downloading Node.js v20 Portable - about 40 MB...
set "NODE_DIR=%DIST_DIR%\runtime\node"
set "NODE_URL=https://nodejs.org/dist/v20.19.1/node-v20.19.1-win-x64.zip"
set "NODE_ZIP=%DIST_DIR%\node_download.zip"
if exist "%NODE_DIR%\node.exe" (
    echo   SKIP - Node.js already exists
    goto skip_node
)
echo   Downloading -- please wait...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing" 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo ERROR: Failed to download Node.js
    echo   Check internet connection and try again
    pause
    exit /b 1
)
echo   Extracting Node.js...
powershell -NoProfile -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%DIST_DIR%\runtime\' -Force" 2>>"%LOG%"
del /f /q "%NODE_ZIP%" 2>nul
for /d %%i in ("%DIST_DIR%\runtime\node-*") do (
    if not "%%~nxi"=="node" ren "%%i" "node" 2>>"%LOG%"
)
:skip_node
if not exist "%NODE_DIR%\node.exe" (
    echo ERROR: node.exe not found after extraction
    pause
    exit /b 1
)
echo   OK - Node.js v20 ready
:: ----------------------------------------------------------
:: Step 6b: Download Python Embeddable
:: ----------------------------------------------------------
echo.
echo [6b] Downloading Python 3.11 Embeddable - about 15 MB...
set "PY_DIR=%DIST_DIR%\runtime\python"
set "PY_URL=https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
set "PY_ZIP=%DIST_DIR%\python_download.zip"
if exist "%PY_DIR%\python.exe" (
    echo   SKIP - Python already exists
    goto skip_python
)
echo   Downloading -- please wait...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_ZIP%' -UseBasicParsing" 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo ERROR: Failed to download Python
    echo   Check internet connection and try again
    pause
    exit /b 1
)
echo   Extracting Python...
mkdir "%PY_DIR%" 2>nul
powershell -NoProfile -Command "Expand-Archive -Path '%PY_ZIP%' -DestinationPath '%PY_DIR%' -Force" 2>>"%LOG%"
del /f /q "%PY_ZIP%" 2>nul
echo   Enabling import site...
for %%f in ("%PY_DIR%\python*._pth") do (
    powershell -NoProfile -Command "(Get-Content '%%f') -replace '#import site','import site' | Set-Content '%%f'" 2>>"%LOG%"
)
echo   Installing pip...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%PY_DIR%\get-pip.py' -UseBasicParsing" 2>>"%LOG%"
"%PY_DIR%\python.exe" "%PY_DIR%\get-pip.py" --quiet 2>>"%LOG%"
echo   Installing Python packages: fastapi, pandas, uvicorn...
"%PY_DIR%\python.exe" -m pip install fastapi uvicorn pandas httpx python-dotenv --quiet --no-warn-script-location 2>>"%LOG%"
:skip_python
if not exist "%PY_DIR%\python.exe" (
    echo ERROR: python.exe not found
    pause
    exit /b 1
)
echo   Verifying Python packages...
"%PY_DIR%\python.exe" -c "import fastapi, uvicorn, pandas, httpx" >nul 2>>"%LOG%"
if %errorlevel% neq 0 (
    echo   Installing missing Python packages...
    "%PY_DIR%\python.exe" -m pip install fastapi uvicorn pandas httpx python-dotenv --quiet --no-warn-script-location 2>>"%LOG%"
    "%PY_DIR%\python.exe" -c "import fastapi, uvicorn, pandas, httpx" >nul 2>>"%LOG%"
    if %errorlevel% neq 0 (
        echo ERROR: Python packages for Y-ai failed to install. See build.log
        pause
        exit /b 1
    )
)
echo   OK - Python 3.11 ready
:: ----------------------------------------------------------
:: Step 7: Copy launcher files
:: ----------------------------------------------------------
echo.
echo [7/8] Copying launcher files...
copy /y "%PKG_DIR%\launcher.bat"       "%DIST_DIR%\launcher.bat"   >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\stop.bat"           "%DIST_DIR%\stop.bat"       >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\allow-network.bat"  "%DIST_DIR%\allow-network.bat" >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\check-yai.bat"      "%DIST_DIR%\check-yai.bat"     >nul 2>>"%LOG%"
if not exist "%PKG_DIR%\check-yai.ps1" (
    echo ERROR: check-yai.ps1 not found in %PKG_DIR%
    pause
    exit /b 1
)
copy /y "%PKG_DIR%\check-yai.ps1"      "%DIST_DIR%\check-yai.ps1"     >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\setup-ollama.bat"   "%DIST_DIR%\setup-ollama.bat"  >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\fix-database.bat"   "%DIST_DIR%\fix-database.bat" >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\Y-ai-launcher.vbs"  "%DIST_DIR%\Y-ai-launcher.vbs" >nul 2>>"%LOG%"
copy /y "%PKG_DIR%\assets\Y-ai.ico"    "%DIST_DIR%\Y-ai.ico"       >nul 2>>"%LOG%"
echo   OK - Launcher files copied
:: ----------------------------------------------------------
:: Build EXE with Inno Setup
:: ----------------------------------------------------------
echo.
echo ================================================
echo   Building EXE with Inno Setup...
echo ================================================
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe"       set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC (
    echo.
    echo   Inno Setup not found.
    echo   Download: https://jrsoftware.org/isdl.php
    echo   Then run this script again.
    echo.
    echo   dist folder is ready at:
    echo   %DIST_DIR%
    goto :done
)
echo   Found Inno Setup: %ISCC%
echo   Compiling (2-5 minutes)...
echo.
"%ISCC%" /O"%OUT_DIR%" "%PKG_DIR%\setup.iss" >> "%LOG%" 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ================================================
    echo   SUCCESS!
    echo ================================================
    echo.
    for %%f in ("%OUT_DIR%\*.exe") do (
        echo   Installer: %%~nxf
        echo   Location:  %%~dpf
    )
) else (
    echo.
    echo ERROR: Inno Setup compilation failed.
    echo   See: %LOG%
    pause
    exit /b 1
)
:done
echo.
echo ================================================
echo   BUILD COMPLETE
echo   Log: %LOG%
echo ================================================
echo.
pause

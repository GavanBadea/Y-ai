@echo off
chcp 65001 >nul
title WMS Backend (dev)
cd /d "%~dp0"

set "NODE_ENV=development"

echo ========================================
echo   WMS Backend — dev
echo   http://localhost:3000
echo ========================================
echo.

if not exist "node_modules\" (
  echo تثبيت الحزم...
  call npm install
  if errorlevel 1 goto fail
)

if exist "node_modules\.bin\nodemon.cmd" (
  call node_modules\.bin\nodemon.cmd server.js
) else (
  echo ملاحظة: nodemon غير مثبت — تشغيل node server.js مباشرة
  call node server.js
)
if errorlevel 1 goto fail
goto end

:fail
echo.
echo [خطأ] فشل تشغيل الخادم — جرّب: npm install
pause

:end

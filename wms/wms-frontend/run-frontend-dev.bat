@echo off
chcp 65001 >nul
title WMS Frontend (dev)
cd /d "%~dp0"

echo ========================================
echo   WMS Frontend — Vite dev server
echo   http://localhost:5173
echo ========================================
echo.

call npm run dev
if errorlevel 1 (
  echo.
  echo [خطأ] فشل تشغيل الواجهة — تأكد من: npm install
  pause
)

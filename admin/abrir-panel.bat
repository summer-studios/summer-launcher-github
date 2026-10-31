@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
title Summer Admin
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Necesitas Node.js 18 o superior: https://nodejs.org
  pause
  exit /b 1
)
if not exist "admin\admin.config.json" (
  echo [ERROR] Falta admin\admin.config.json. Copia admin.config.example.json a admin.config.json y pega tu token. Lee LEEME-ADMIN.txt.
  pause
  exit /b 1
)
node admin\summer-admin.js panel
pause

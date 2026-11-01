@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Compilador - Summer Admin
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Instala Node.js desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
echo [1/2] Instalando dependencias...
call npm install
if errorlevel 1 goto fallo
echo.
echo [2/2] Compilando Summer Admin...
call npm run dist
if errorlevel 1 goto fallo
start "" "%~dp0dist"
pause
exit /b 0
:fallo
echo.
echo [ERROR] Algo fallo. Revisa los mensajes de arriba.
pause
exit /b 1

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Compilador - Summer Launcher
echo ==============================
echo  Compilador de Summer Launcher
echo ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No tienes Node.js instalado. Descargalo en https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

echo [1/3] Instalando dependencias...
call npm install
if errorlevel 1 goto fallo

echo.
echo [2/3] Compilando instalador .exe...
call npm run dist
if errorlevel 1 goto fallo

echo.
echo [3/3] Listo. Abriendo carpeta dist...
start "" "%~dp0dist"
pause
exit /b 0

:fallo
echo.
echo [ERROR] Algo fallo. Revisa los mensajes de arriba.
pause
exit /b 1

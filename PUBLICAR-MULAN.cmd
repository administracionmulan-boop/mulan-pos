@echo off
chcp 65001 >nul
title MULAN POS - Publicar
cd /d "%~dp0"
set /p MSG=" Describa brevemente el cambio (Enter para omitir): "
if "%MSG%"=="" (node scripts\publicar.js) else (node scripts\publicar.js -m "%MSG%")
echo.
pause

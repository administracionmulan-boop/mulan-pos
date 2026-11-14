@echo off
chcp 65001 >nul
title MULAN POS - Instalacion
cd /d "%~dp0"
echo.
echo  ==== MULAN POS - Instalacion guiada ====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js no esta instalado. Instalando...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo  Listo. CIERRE esta ventana y vuelva a abrir INSTALAR-MULAN.cmd
  pause
  exit /b
)
where git >nul 2>nul
if errorlevel 1 (
  echo  Git no esta instalado. Instalando...
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
  echo.
  echo  Listo. CIERRE esta ventana y vuelva a abrir INSTALAR-MULAN.cmd
  pause
  exit /b
)
if not exist node_modules\@google\clasp (
  echo  Instalando dependencias, 1-2 minutos...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  Error instalando dependencias. Revise su conexion a internet.
    pause
    exit /b 1
  )
)
node scripts\instalar.js
echo.
pause

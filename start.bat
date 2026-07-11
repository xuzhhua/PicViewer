@echo off
title PicViewer - Local Image Browser

echo ========================================
echo        PicViewer Image Browser
echo ========================================
echo.

:: Read port from config file using Node.js (robust JSON parsing)
set CONFIG_PORT=
for /f %%a in ('node -e "try{process.stdout.write(String(require('./server/config.json').port||''))}catch(e){}" 2^>nul') do set CONFIG_PORT=%%a

:: Fallback to default
if "%CONFIG_PORT%"=="" set CONFIG_PORT=3456

set PORT=%CONFIG_PORT%
echo Port: %PORT%
echo.

echo Building frontend...
cd /d "%~dp0"

if exist "client\node_modules\" (
    cd client
    call npm run build
    cd ..
    echo Frontend built successfully.
) else (
    echo WARNING: client/node_modules not found. Run: cd client ^&^& npm install
)

echo.
echo Starting PicViewer...
echo URL: http://localhost:%PORT%
echo.

node server/index.js

pause

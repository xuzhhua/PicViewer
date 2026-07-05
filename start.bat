@echo off
title PicViewer - Local Image Browser

echo ========================================
echo        PicViewer Image Browser
echo ========================================
echo.

:: Read port from config file
set CONFIG_PORT=
for /f "tokens=2 delims=:," %%a in ('findstr "port" "%~dp0server\config.json" 2^>nul') do (
    set CONFIG_PORT=%%a
    goto :got_port
)
:got_port
:: Trim spaces
set CONFIG_PORT=%CONFIG_PORT: =%

:: Fallback to default
if "%CONFIG_PORT%"=="" set CONFIG_PORT=3456

echo Current port: %CONFIG_PORT%
echo.

set /p CUSTOM_PORT="Enter port (press Enter for %CONFIG_PORT%): "

if not "%CUSTOM_PORT%"=="" (
    set PORT=%CUSTOM_PORT%
) else (
    set PORT=%CONFIG_PORT%
)

:: Save new port to config
if not "%CUSTOM_PORT%"=="" (
    echo { "port": %CUSTOM_PORT% } > "%~dp0server\config.json"
    echo Port saved to config.json.
)

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

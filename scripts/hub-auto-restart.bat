@echo off
:: Revamp Hub — Auto-restart wrapper
:: Restarts the Hub server if it crashes. Press Ctrl+C to stop.
echo [Hub] Starting with auto-restart...
:loop
cd /d "%~dp0..\Hub"
node server.js
echo [Hub] Process exited. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop

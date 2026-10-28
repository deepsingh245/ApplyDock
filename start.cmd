@echo off
cd /d "%~dp0"
rem Build the web app so the helper always serves the current code (a few seconds). Needs Node.js 22+.
where npm >nul 2>nul
if errorlevel 1 (
  if not exist "web\dist\index.html" echo Node.js is not installed, so the web app cannot be built. Install Node.js 22+ and run start.cmd again.
) else (
  if not exist "web\node_modules" call npm --prefix web ci --no-audit --no-fund
  call npm --prefix web run build --silent
)
py -3 server.py
pause

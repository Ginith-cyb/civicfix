@echo off
cd /d "%~dp0"
node -v >nul 2>&1 || (echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again. & pause & exit /b)
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:3000"
node server.js
pause

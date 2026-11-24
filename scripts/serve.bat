@echo off
REM Started by scripts\hidden.vbs at logon — there is no console window.
REM Output goes to data\server.log; delete that file to clear it.
REM Loops so a crashed server comes back by itself: a kiosk that is silently down is
REM indistinguishable from a broken reader, and nobody would think to check.

cd /d "%~dp0.."
if not exist data mkdir data

:loop
echo [%DATE% %TIME%] starting >> data\server.log
if exist "node_modules\.bin\tsx.cmd" (
  "node_modules\.bin\tsx.cmd" src\server.ts >> data\server.log 2>&1
) else (
  call npx tsx src\server.ts >> data\server.log 2>&1
)
echo [%DATE% %TIME%] server exited; restarting in 5s >> data\server.log
REM ping, not timeout: timeout needs a console and this runs without one.
ping -n 6 127.0.0.1 >nul
goto loop

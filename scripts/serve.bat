@echo off
REM Started by scripts\hidden.vbs at logon — there is no console window.
REM Output goes to data\server.log; delete that file to clear it.
REM Loops so a crashed server comes back by itself: a kiosk that is silently down is
REM indistinguishable from a broken reader, and nobody would think to check.

cd /d "%~dp0.."
if not exist data mkdir data

where node >nul 2>nul
if errorlevel 1 (
  echo [%DATE% %TIME%] node is not on PATH - cannot start. Install Node.js or add it. >> data\server.log
  goto :eof
)

:loop
echo [%DATE% %TIME%] starting >> data\server.log
REM node --import tsx, NOT tsx.cmd: invoking a .cmd/.bat without `call` transfers control
REM away for good, so this loop never ran again after the first exit - which is why the
REM restart silently stopped working. Running node directly also keeps cmd out of the
REM process tree, so killing the server leaves a loop alive to restart it.
node --import tsx src\server.ts >> data\server.log 2>&1
echo [%DATE% %TIME%] server exited; restarting in 5s >> data\server.log
REM ping, not timeout: timeout needs a console and this runs without one.
ping -n 6 127.0.0.1 >nul
goto loop

@echo off
REM Started by scripts\hidden.vbs at logon. Keeps a fullscreen kiosk window up.
REM Change the browser path if this PC uses Chrome instead of Edge.

set BROWSER="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set URLFILE=%~dp0..\data\kiosk-url.txt

REM The server writes its own URL at boot, so PORT is set in exactly one place: .env.
:waiturl
if exist "%URLFILE%" goto haveurl
ping -n 3 127.0.0.1 >nul
goto waiturl

:haveurl
set /p URL=<"%URLFILE%"

:loop
REM Relaunch only when the browser is gone, so this does not spawn window after window.
tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | find /i "msedge.exe" >nul
if errorlevel 1 (
  start "" %BROWSER% --kiosk --app=%URL% --no-first-run --no-default-browser-check --disable-features=Translate
)
ping -n 21 127.0.0.1 >nul
goto loop

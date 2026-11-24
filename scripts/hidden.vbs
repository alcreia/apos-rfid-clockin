' Starts the clock-in server with no console window, and optionally the kiosk browser.
'
' KIOSK_AUTOSTART in .env decides the browser:
'   1 or absent  -> open the fullscreen kiosk at logon   (the door PC)
'   0            -> server only; open the page yourself  (a dev machine)
'
' Point the scheduled task at this file, not at the .bat files:
'   schtasks /create /tn "RFID clock-in kiosk" /tr "wscript.exe D:\apos-rfid\scripts\hidden.vbs" /sc onlogon
'
' Window style 0 = hidden, third argument False = do not wait for them to finish.
' Server output still goes to data\server.log, so a crash is diagnosable.
Option Explicit

Dim sh, fso, base, envFile, autostart
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
' .env sits in the project root, one level above this script — not next to it.
envFile = fso.GetParentFolderName(base) & "\.env"
autostart = ReadKey(envFile, "KIOSK_AUTOSTART", "1")

sh.Run """" & base & "\serve.bat""", 0, False

If LCase(autostart) <> "0" Then
  sh.Run """" & base & "\kiosk.bat""", 0, False
End If

' Minimal .env reader: "KEY=value" lines, # comments, no quoting rules to get wrong.
Function ReadKey(path, key, fallback)
  Dim ts, line, parts
  ReadKey = fallback
  If Not fso.FileExists(path) Then Exit Function
  Set ts = fso.OpenTextFile(path, 1)
  Do While Not ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If InStr(line, "=") > 1 And Left(line, 1) <> "#" Then
      parts = Split(line, "=", 2)
      If LCase(Trim(parts(0))) = LCase(key) Then ReadKey = Trim(parts(1))
    End If
  Loop
  ts.Close
End Function

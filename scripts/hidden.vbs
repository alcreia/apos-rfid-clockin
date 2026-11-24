' Starts the clock-in server and the kiosk browser with NO visible console windows.
'
' Point the scheduled task at this file, not at the .bat files:
'   schtasks /create /tn "RFID kiosk" /tr "wscript.exe \"D:\apos-rfid\scripts\hidden.vbs\"" /sc onlogon
'
' Window style 0 = hidden, third argument False = do not wait for them to finish.
' Server output still goes to data\server.log, so a crash is diagnosable.
Option Explicit

Dim sh, fso, base
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)

sh.Run """" & base & "\serve.bat""", 0, False
sh.Run """" & base & "\kiosk.bat""", 0, False

' app-triggered-boot.vbs - windowless launcher for app-triggered-boot.ps1.
' The DSH boot hook spawns wscript.exe on this file; going through VBS avoids the
' console window that a direct powershell.exe spawn produces under Electron.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\Administrator\.dsh\app-triggered-boot.ps1""", 0, False
Set sh = Nothing

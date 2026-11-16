' wechat-bridge-guard.vbs - run the one-shot bridge guard with no console window.
' wscript.exe is a GUI-subsystem binary, so the powershell child gets SW_HIDE.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\wechat-bridge-guard.ps1", 0, False
Set sh = Nothing

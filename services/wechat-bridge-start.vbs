' wechat-bridge-start.vbs - launch the bridge launcher with no console window.
' wscript.exe is a GUI-subsystem binary: the powershell child gets SW_HIDE, so the node
' bridge never shows a window or a taskbar entry. Paths have no spaces, so no extra quotes.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\wechat-bridge-start.ps1", 0, False
Set sh = Nothing

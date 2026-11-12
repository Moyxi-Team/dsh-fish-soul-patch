' wechat-stack-watchdog.vbs - start the WeChat fish-soul watchdog with no console window.
' Invoked from the Startup folder (WeChatFishStack.vbs) after logon. wscript.exe is a GUI
' subsystem binary, so the resident powershell loop runs with window style 0 and never
' shows a window, a taskbar entry or steals focus.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\wechat-stack-watchdog.ps1", 0, False
Set sh = Nothing

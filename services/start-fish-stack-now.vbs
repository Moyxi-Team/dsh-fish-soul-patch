' start-fish-stack-now.vbs - manual one-click fallback.
' Normal path: DSH starts -> boot hook (boot-hooks.mjs) -> app-triggered-boot.ps1 -> both watchdogs.
' If that hook ever fails, double-click this file to bring the whole stack up by hand.
' Both watchdogs are single-instance (named mutex), so running this twice is harmless.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\wscript.exe //B //Nologo ""C:\Users\Administrator\.dsh\fish-stack-watchdog.vbs""", 0, False
sh.Run "C:\Windows\System32\wscript.exe //B //Nologo ""C:\Users\Administrator\.dsh\wechat-stack-watchdog.vbs""", 0, False
Set sh = Nothing

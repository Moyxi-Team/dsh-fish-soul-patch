' fish-stack-watchdog.vbs — 无窗口启动看门狗
' 计划任务 "DSH Fish Stack" 的动作指向本文件；wscript.exe 是 GUI 子系统，本身不创建控制台，
' 内部的 powershell 以 window style 0 启动 —— 完全不可见、不进任务栏、不抢焦点。
' 注意：路径里没有空格，不要额外加引号（WScript.Shell.Run 会在带引号时解析失败）。

Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\fish-stack-watchdog.ps1", 0, False
Set sh = Nothing

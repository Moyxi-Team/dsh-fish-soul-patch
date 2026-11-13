' fish-soul-patch-guard.vbs - re-apply the dsh-fish-soul patch set after a DSH launch, silently.
' DSH runs a pnpm install on start-up and rewrites node_modules\dsh-fish-soul to the pristine
' upstream build, which silently drops every patch. Fired from app-triggered-boot.ps1.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\fish-soul-patch-guard.ps1", 0, False
Set sh = Nothing

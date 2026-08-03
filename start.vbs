Dim shell
Set shell = CreateObject("WScript.Shell")

shell.Run "cmd /k ""cd /d D:\Projects\FlowTix && npm run dev""", 0, False
WScript.Sleep 3000
shell.Run "cmd /k ""cd /d D:\Projects\FlowTix\extraction-service && npm run dev""", 0, False

WScript.Quit
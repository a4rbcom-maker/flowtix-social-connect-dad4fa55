Set objShell = CreateObject("WScript.Shell")
Set objExec = objShell.Exec("cmd /c netstat -ano")
strOutput = objExec.StdOut.ReadAll

lines = Split(strOutput, vbCrLf)
For Each line In lines
    If InStr(line, ":5173") > 0 Or InStr(line, ":3100") > 0 Then
        parts = Split(Trim(line))
        pid = parts(UBound(parts))
        objShell.Run "taskkill /F /PID " & pid, 0, True
    End If
Next

WScript.Quit
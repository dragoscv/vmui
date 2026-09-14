' Launch a console program with NO window at all. Task Scheduler's "Hidden"
' flag only hides the task from the UI; a console exe still flashes a window
' for a few hundred ms under an interactive token. WScript.Shell.Run with
' window style 0 does not. Used by vmui-service and vmui-publish-* tasks.
'
'   wscript.exe hidden-run.vbs <exe> [args...]
'
Option Explicit
Dim sh, i, cmd
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 2
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
    If InStr(WScript.Arguments(i), " ") > 0 Then
        cmd = cmd & """" & WScript.Arguments(i) & """ "
    Else
        cmd = cmd & WScript.Arguments(i) & " "
    End If
Next
' 0 = hidden window, False = do not wait (the launcher decides its own lifetime)
sh.Run cmd, 0, False

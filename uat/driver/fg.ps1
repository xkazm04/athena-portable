Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h = [FG]::GetForegroundWindow()
$pid2 = 0; [void][FG]::GetWindowThreadProcessId($h, [ref]$pid2)
$sb = New-Object System.Text.StringBuilder 120; [void][FG]::GetWindowText($h, $sb, 120)
$name = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
"$name|$($sb.ToString())"

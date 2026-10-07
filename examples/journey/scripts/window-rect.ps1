# docs/demo.md section 5 ("desktop" segment): the screen rectangles of a process's visible windows.
#
# The window-finding half of uat/driver/crop.ps1, copied rather than imported (that file belongs to
# the UAT driver and also writes PNGs). One line per visible window wider than 20 px:
#   rect=<left>,<top>,<right>,<bottom>
# in physical pixels: the process declares itself DPI aware first, so a scaled display reports
# the same coordinates the screen grabber (ddagrab or gdigrab) captures in.
param([string]$process = "athena-desktop")
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class AthenaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L,T,R,B; }
  public static List<string> Find(uint pid){ var o=new List<string>(); EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p==pid && IsWindowVisible(h) && !IsIconic(h)){ RECT r; GetWindowRect(h,out r); if(r.R-r.L>20) o.Add(r.L+","+r.T+","+r.R+","+r.B);} return true;}, IntPtr.Zero); return o; }
}
"@
[void][AthenaWin]::SetProcessDPIAware()
$p = Get-Process $process -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { "no process $process"; exit 3 }
foreach ($w in [AthenaWin]::Find($p.Id)) { "rect=$w" }

param($outprefix)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L,T,R,B; }
  public static List<string> Find(uint pid){ var o=new List<string>(); EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p==pid && IsWindowVisible(h)){ RECT r; GetWindowRect(h,out r); if(r.R-r.L>20) o.Add(r.L+","+r.T+","+r.R+","+r.B);} return true;}, IntPtr.Zero); return o; }
}
"@
$p = Get-Process athena-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { "no process"; exit }
$i = 0
foreach ($w in [W]::Find($p.Id)) {
  $a = $w.Split(','); $l=[int]$a[0]; $t=[int]$a[1]; $r=[int]$a[2]; $b=[int]$a[3]
  $bmp = New-Object System.Drawing.Bitmap ($r-$l),($b-$t)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($l,$t,0,0,$bmp.Size)
  $f = "$outprefix-$i.png"; $bmp.Save($f); "$f rect=$l,$t,$r,$b ($($r-$l)x$($b-$t))"; $i++
}

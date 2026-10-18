# Real-world wheel visibility probe (Windows): launch the Explorer verb command exactly as Explorer does
# (one process per selected file, optionally with the tray helper already running), keep an Explorer window
# in the foreground, then sample the wheel window's visibility every 50 ms and count flickers.
param(
  [string[]]$Files,
  [switch]$WithHelper,
  [int]$Seconds = 6,
  [string]$Label = 'probe'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static IntPtr FirstVisible(string title) { foreach (var h in Find(title)) if (IsWindowVisible(h)) return h; return IntPtr.Zero; }
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, int rop);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  // pixel of the window's own rendered content (PrintWindow + PW_RENDERFULLCONTENT also captures GPU/DirectComposition
  // output, which plain screen BitBlt misses for transparent Chromium windows); x,y relative to the window; 0xRRGGBB
  public static int WindowPixel(IntPtr h, int x, int y) {
    RECT r; GetWindowRect(h, out r); int w = r.R - r.L, ht = r.B - r.T; if (w <= 0 || ht <= 0) return -1;
    IntPtr sdc = GetDC(IntPtr.Zero), mdc = CreateCompatibleDC(sdc), bmp = CreateCompatibleBitmap(sdc, w, ht), old = SelectObject(mdc, bmp);
    bool ok = PrintWindow(h, mdc, 2); uint c = GetPixel(mdc, x, y);
    SelectObject(mdc, old); DeleteObject(bmp); DeleteDC(mdc); ReleaseDC(IntPtr.Zero, sdc);
    if (!ok) return -1; return (int)(((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF));
  }
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  // screen pixel including layered/transparent windows (BitBlt with CAPTUREBLT); returns 0xRRGGBB
  public static int Pixel(int x, int y) {
    IntPtr sdc = GetDC(IntPtr.Zero), mdc = CreateCompatibleDC(sdc), bmp = CreateCompatibleBitmap(sdc, 1, 1), old = SelectObject(mdc, bmp);
    BitBlt(mdc, 0, 0, 1, 1, sdc, x, y, 0x00CC0020 | 0x40000000);
    uint c = GetPixel(mdc, 0, 0);
    SelectObject(mdc, old); DeleteObject(bmp); DeleteDC(mdc); ReleaseDC(IntPtr.Zero, sdc);
    return (int)(((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF));
  }
  public static List<IntPtr> Find(string title) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString() == title) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static bool AnyVisible(string title) { foreach (var h in Find(title)) if (IsWindowVisible(h) && !IsIconic(h)) return true; return false; }
  public static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
}
'@
$cmd = (Get-ItemProperty 'HKCU:\Software\Classes\SystemFileAssociations\.jpg\shell\MambaConvert\command').'(default)'
if ($cmd -notmatch '^"([^"]+)"\s+(.*)$') { throw "bad verb command: $cmd" }
$exe = $Matches[1]; $tmpl = $Matches[2]
Get-Process 'Mamba Convert' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1
[void][W]::SetCursorPos([int]([W]::GetSystemMetrics(0) / 2), [int]([W]::GetSystemMetrics(1) / 2))
if ($WithHelper) { Start-Process -FilePath $exe -ArgumentList '--background' | Out-Null; Start-Sleep 6 }
# Explorer in the foreground, like a real right-click
$dir = Split-Path $Files[0]
Start-Process explorer.exe -ArgumentList "`"$dir`""; Start-Sleep 3
$ex = (New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.FullName -like '*explorer.exe' } | Select-Object -Last 1
if ($ex) { [void][W]::SetForegroundWindow([IntPtr]$ex.HWND) }
Write-Host "[$Label] foreground before launch: '$([W]::Title([W]::GetForegroundWindow()))'"
# one process per file, a few ms apart, as Explorer does
foreach ($f in $Files) { Start-Process -FilePath $exe -ArgumentList ($tmpl.Replace('%1', $f)) | Out-Null; Start-Sleep -Milliseconds 30 }
$title = 'Mamba Convert wheel'
$sw = [Diagnostics.Stopwatch]::StartNew(); $first = $null
while ($sw.ElapsedMilliseconds -lt 15000) { if ([W]::AnyVisible($title)) { $first = $sw.ElapsedMilliseconds; break }; Start-Sleep -Milliseconds 20 }
if ($null -eq $first) { throw "[$Label] the wheel never became visible" }
Write-Host "[$Label] wheel visible after $first ms; foreground now: '$([W]::Title([W]::GetForegroundWindow()))'"
# Rest the real mouse cursor on the top slice of the inner ring, as a user does when choosing a category.
Start-Sleep -Milliseconds 400
$h = [W]::FirstVisible($title); $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r)
$cx = [int](($r.L + $r.R) / 2); $cy = [int](($r.T + $r.B) / 2); $scale = ($r.R - $r.L) / 720.0
$px = $cx; $py = [int]($cy - 118 * $scale)
[void][W]::SetCursorPos($px, $py - 6); Start-Sleep -Milliseconds 60; [void][W]::SetCursorPos($px, $py)
Start-Sleep -Milliseconds 600
# the hovered slice is orange (#ff7a00); sample its on-screen colour too, which catches fade/redraw flicker
function IsOrange($c) { $rr = ($c -shr 16) -band 255; $gg = ($c -shr 8) -band 255; $bb = $c -band 255; return ($rr -gt 200 -and $gg -gt 80 -and $gg -lt 160 -and $bb -lt 80) }
$c0 = [W]::WindowPixel($h, $px - $r.L, $py - $r.T); Write-Host ("[$Label] slice pixel at ($px,$py) = #{0:x6}" -f $c0)
$samples = 0; $hidden = 0; $transitions = 0; $prev = $true; $trace = New-Object System.Text.StringBuilder; $notOrange = 0; $colours = @{}; $changes = 0; $prevC = $null
$sw.Restart()
while ($sw.ElapsedMilliseconds -lt ($Seconds * 1000)) {
  $v = [W]::AnyVisible($title); $samples++
  $c = [W]::WindowPixel($h, $px - $r.L, $py - $r.T); if (!(IsOrange $c)) { $notOrange++ }; if ($null -ne $prevC -and $c -ne $prevC) { $changes++ }; $prevC = $c; $colours[('{0:x6}' -f $c)] = 1 + [int]$colours[('{0:x6}' -f $c)]
  if (!$v) { $hidden++ }
  if ($v -ne $prev) { $transitions++; [void]$trace.Append("$($sw.ElapsedMilliseconds)ms:$(if ($v) {'show'} else {'hide'}) ") }
  $prev = $v; Start-Sleep -Milliseconds 50
}
$wins = @([W]::Find($title)).Count
Write-Host "[$Label] $samples samples over $Seconds s: hidden=$hidden transitions=$transitions notOrange=$notOrange colourChanges=$changes wheelWindows=$wins $trace"
Write-Host "[$Label] slice colours seen: $(($colours.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object { "#$($_.Key)x$($_.Value)" }) -join ' ')"
$procs = @(Get-Process 'Mamba Convert' -ErrorAction SilentlyContinue); $pids = @($procs | ForEach-Object { $_.Id })
Write-Host "[$Label] Mamba Convert processes still running: $($procs.Count)"
$log = Join-Path $env:APPDATA 'Mamba Convert\logs\wheel.log'
if (Test-Path $log) { Write-Host "[$Label] --- $log (tail) ---"; Get-Content $log -Tail 40 }
Get-Process 'Mamba Convert' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1
if ($hidden -gt 0 -or $transitions -gt 0) { throw "[$Label] FLICKER: the wheel was hidden in $hidden of $samples samples ($transitions transitions)" }
# A steady wheel renders the hovered slice in one colour; a re-animating wheel cycles through fade colours.
if ($changes -gt 2) { throw "[$Label] VISUAL FLICKER: the hovered slice changed colour $changes times in $samples samples ($(($colours.Keys) -join ','))" }
if ($notOrange -eq $samples) { Write-Host "::warning::[$Label] the hovered slice was never read as orange (window capture may be unsupported); colour stability still asserted" }
if (Test-Path $log) {
  $loops = @(Select-String -Path $log -Pattern 'render-loop').Count; if ($loops) { throw "[$Label] render loop logged by the wheel" }
  # renderer telemetry from this run: with the cursor resting on one slice, there must be (almost) no re-renders
  $stats = @(Get-Content $log | Where-Object { $_ -match '"stat":"renders"' } | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.pid -in $pids })
  $busy = @($stats | Where-Object { $_.last2s -gt 6 })
  Write-Host "[$Label] renderer render counts per 2 s: $(($stats | ForEach-Object { $_.last2s }) -join ',')"
  if ($busy.Count -gt 1) { throw "[$Label] the wheel kept re-rendering under a resting cursor: $(($busy | ForEach-Object { $_.last2s }) -join ',') renders per 2 s" }
}
if ($wins -ne 1) { throw "[$Label] expected exactly one wheel window, found $wins" }
Write-Host "[$Label] OK: the wheel stayed visible for $Seconds s"

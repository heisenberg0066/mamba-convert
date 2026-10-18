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
$samples = 0; $hidden = 0; $transitions = 0; $prev = $true; $trace = New-Object System.Text.StringBuilder
$sw.Restart()
while ($sw.ElapsedMilliseconds -lt ($Seconds * 1000)) {
  $v = [W]::AnyVisible($title); $samples++
  if (!$v) { $hidden++ }
  if ($v -ne $prev) { $transitions++; [void]$trace.Append("$($sw.ElapsedMilliseconds)ms:$(if ($v) {'show'} else {'hide'}) ") }
  $prev = $v; Start-Sleep -Milliseconds 50
}
$wins = @([W]::Find($title)).Count
Write-Host "[$Label] $samples samples over $Seconds s: hidden=$hidden transitions=$transitions wheelWindows=$wins $trace"
$procs = @(Get-Process 'Mamba Convert' -ErrorAction SilentlyContinue)
Write-Host "[$Label] Mamba Convert processes still running: $($procs.Count)"
$log = Join-Path $env:APPDATA 'Mamba Convert\logs\wheel.log'
if (Test-Path $log) { Write-Host "[$Label] --- $log (tail) ---"; Get-Content $log -Tail 40 }
Get-Process 'Mamba Convert' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1
if ($hidden -gt 0 -or $transitions -gt 0) { throw "[$Label] FLICKER: the wheel was hidden in $hidden of $samples samples ($transitions transitions)" }
if ($wins -ne 1) { throw "[$Label] expected exactly one wheel window, found $wins" }
Write-Host "[$Label] OK: the wheel stayed visible for $Seconds s"

param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('windows','focus','minimize','maximize','restore','snap_left','snap_right','chrome_next','chrome_previous','chrome_close','youtube_play','youtube_pause','youtube_toggle','hotkey','screenshot','input')]
  [string]$Action,
  [long]$WindowId = 0,
  [int]$ParentId = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public class JarvisWindow {
  public long id; public string title; public string app; public bool active;
}
public class JarvisWindows {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int height, bool repaint);
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Key { public ushort code,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Key key; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, Input[] input, int size);
  static void SendChecked(IntPtr h, Input[] input) {
    if(GetForegroundWindow()!=h) throw new Exception("Focus changed; no input was sent. Take another screenshot.");
    if(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(Input)))!=input.Length) throw new Exception("Windows blocked some or all input. Inspect the screen before retrying.");
  }
  public static void TypeText(IntPtr h, string text) {
    var input = new Input[text.Length*2];
    for(int i=0;i<text.Length;i++) {
      input[2*i].type=1; input[2*i].data.key.scan=text[i]; input[2*i].data.key.flags=4;
      input[2*i+1]=input[2*i]; input[2*i+1].data.key.flags=6;
    }
    SendChecked(h,input);
  }
  public static void Press(IntPtr h, ushort[] keys) {
    var input = new Input[keys.Length*2];
    for(int i=0;i<keys.Length;i++) {
      input[i].type=1; input[i].data.key.code=keys[i];
      input[keys.Length+i].type=1; input[keys.Length+i].data.key.code=keys[keys.Length-1-i]; input[keys.Length+i].data.key.flags=2;
      if(keys[i]>=33 && keys[i]<=46) input[i].data.key.flags|=1;
      if(keys[keys.Length-1-i]>=33 && keys[keys.Length-1-i]<=46) input[keys.Length+i].data.key.flags|=1;
    }
    SendChecked(h,input);
  }
  public static void Pointer(IntPtr h, int x, int y, string action, int delta) {
    if(GetForegroundWindow()!=h || GetAncestor(WindowFromPoint(new Point { x=x,y=y }),2)!=h) throw new Exception("The target point is covered by another window. Take another screenshot.");
    if(!SetCursorPos(x,y)) throw new Exception("Windows refused pointer movement.");
    if(action=="scroll") {
      var wheel = new Input[1]; wheel[0].data.mouse.flags=0x800; wheel[0].data.mouse.data=unchecked((uint)(delta*120)); SendChecked(h,wheel); return;
    }
    var click = new Input[2]; click[0].data.mouse.flags=action=="right_click" ? 8u : 2u; click[1].data.mouse.flags=action=="right_click" ? 16u : 4u;
    SendChecked(h,click);
    if(action=="double_click") { Thread.Sleep(60); SendChecked(h,click); }
  }
  [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint key);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint privateData; }
  [DllImport("user32.dll")] static extern int GetMessage(out Message m, IntPtr h, uint min, uint max);
  public static JarvisWindow[] Windows() {
    var list = new List<JarvisWindow>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var text = new StringBuilder(512); GetWindowText(h,text,text.Capacity);
      if (text.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h,out pid);
      try { list.Add(new JarvisWindow { id=h.ToInt64(), title=text.ToString(), app=Process.GetProcessById((int)pid).ProcessName, active=h==GetForegroundWindow() }); } catch {}
      return list.Count < 100;
    }, IntPtr.Zero);
    return list.ToArray();
  }
  public static void Focus(IntPtr h) {
    if (!IsWindow(h) || !IsWindowVisible(h)) throw new Exception("That window is no longer available. Refresh the window list.");
    if (IsIconic(h)) { ShowWindowAsync(h,9); Thread.Sleep(150); }
    SetForegroundWindow(h);
    Thread.Sleep(120);
    if (GetForegroundWindow()!=h) throw new Exception("Windows refused focus. Select the target window and try again.");
  }
  public static void Chord(IntPtr h, ushort[] keys) {
    Focus(h);
    Press(h,keys);
  }
  public static void Hotkey(int parent) {
    if(!RegisterHotKey(IntPtr.Zero,1,0x4003,0x4a)) throw new Exception("Ctrl+Alt+J is already in use.");
    if(parent>0) {
      var watcher = new Thread(delegate() { try { Process.GetProcessById(parent).WaitForExit(); } catch {} Environment.Exit(0); });
      watcher.IsBackground=true; watcher.Start();
    }
    Console.WriteLine("{\"type\":\"status\",\"ready\":true}");
    try { Message msg; int status; while((status=GetMessage(out msg,IntPtr.Zero,0,0))>0) if(msg.message==0x312) Console.WriteLine("{\"type\":\"hotkey\"}"); if(status<0) throw new Exception("Global shortcut message loop failed."); }
    finally { UnregisterHotKey(IntPtr.Zero,1); }
  }
}
'@

try {
  if ($Action -eq 'hotkey') { [JarvisWindows]::Hotkey($ParentId); exit }
  if ($Action -in 'screenshot','input') {
    [void][JarvisWindows]::SetProcessDPIAware()
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $handle = [JarvisWindows]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { throw 'No foreground window is available.' }
    $rect = [JarvisWindows+Rect]::new()
    if (![JarvisWindows]::GetWindowRect($handle,[ref]$rect)) { throw 'Could not read the foreground window bounds.' }
    $bounds = @{ left=$rect.left; top=$rect.top; right=$rect.right; bottom=$rect.bottom }
    if ($Action -eq 'screenshot') {
      $area = [Drawing.Rectangle]::FromLTRB($rect.left,$rect.top,$rect.right,$rect.bottom)
      $area = [Drawing.Rectangle]::Intersect($area,[Windows.Forms.SystemInformation]::VirtualScreen)
      if ($area.Width -le 0 -or $area.Height -le 0) { throw 'The foreground window is off screen.' }
      $bounds = @{ left=$area.Left; top=$area.Top; right=$area.Right; bottom=$area.Bottom; windowLeft=$rect.left; windowTop=$rect.top; windowRight=$rect.right; windowBottom=$rect.bottom }
      $bitmap = [Drawing.Bitmap]::new($area.Width,$area.Height)
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      $scaled = $null; $stream = [IO.MemoryStream]::new()
      try {
        $graphics.CopyFromScreen($area.Location,[Drawing.Point]::Empty,$area.Size)
        $ratio = [Math]::Min(1,1600.0/[Math]::Max($area.Width,$area.Height))
        $width = [Math]::Max(1,[int][Math]::Floor($area.Width*$ratio)); $height = [Math]::Max(1,[int][Math]::Floor($area.Height*$ratio))
        $scaled = [Drawing.Bitmap]::new($bitmap,[Drawing.Size]::new($width,$height))
        $scaled.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
        if ([JarvisWindows]::GetForegroundWindow() -ne $handle) { throw 'Focus changed during capture. Take another screenshot.' }
        @{ windowId=$handle.ToInt64(); bounds=$bounds; width=$width; height=$height; data=[Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress -Depth 4
      } finally { $graphics.Dispose(); $bitmap.Dispose(); if ($scaled) { $scaled.Dispose() }; $stream.Dispose() }
      exit
    }
    if ($payload.windowId -ne $handle.ToInt64()) { throw 'Focus changed. Take another screenshot before input.' }
    $old = $payload.bounds
    if ($rect.left -ne $old.windowLeft -or $rect.top -ne $old.windowTop -or $rect.right -ne $old.windowRight -or $rect.bottom -ne $old.windowBottom) { throw 'The window moved or resized. Take another screenshot.' }
    switch ($payload.action) {
      'type' { [JarvisWindows]::TypeText($handle,[string]$payload.text) }
      'key' {
        $map = @{ enter=13; tab=9; shift=16; escape=27; backspace=8; delete=46; space=32; up=38; down=40; left=37; right=39; home=36; end=35; pageup=33; pagedown=34; ctrl=17; alt=18; f4=115; a=65; c=67; v=86; x=88; z=90; s=83; f=70; l=76 }
        $codes = @($payload.key.Split('+') | ForEach-Object { if (!$map.ContainsKey($_)) { throw 'Unsupported key.' }; $map[$_] })
        [JarvisWindows]::Press($handle,[ushort[]]$codes)
      }
      { $_ -in 'click','double_click','right_click','scroll' } {
        if ($null -eq $payload.x -or $null -eq $payload.y -or $payload.x -lt 0 -or $payload.y -lt 0 -or $payload.x -ge $payload.width -or $payload.y -ge $payload.height) { throw 'Coordinates must be inside the screenshot.' }
        $x = $old.left + [int][Math]::Floor($payload.x * ($old.right-$old.left) / $payload.width)
        $y = $old.top + [int][Math]::Floor($payload.y * ($old.bottom-$old.top) / $payload.height)
        [JarvisWindows]::Pointer($handle,$x,$y,$payload.action,[int]$payload.delta)
      }
      default { throw 'Unsupported computer input.' }
    }
    @{ ok=$true; action=$payload.action; windowId=$handle.ToInt64(); message='Input sent; take another screenshot to verify the result.' } | ConvertTo-Json -Compress
    exit
  }
  $windows = @([JarvisWindows]::Windows())
  if ($Action -eq 'windows') { ConvertTo-Json -InputObject $windows -Compress; exit }
  $browserAction = $Action.StartsWith('chrome_') -or $Action.StartsWith('youtube_')
  if ($WindowId) { $target = $windows | Where-Object id -eq $WindowId | Select-Object -First 1 }
  elseif ($browserAction) {
    $chrome = @($windows | Where-Object app -eq 'chrome')
    if ($Action.StartsWith('youtube_')) { $target = $chrome | Where-Object title -Match 'YouTube' | Select-Object -First 1 }
    else { $target = $chrome | Select-Object -First 1 }
  }
  else { $target = $windows | Where-Object active | Select-Object -First 1 }
  if (!$target) { throw 'No matching window. Open or select the target window first.' }
  if ($browserAction -and $target.app -ne 'chrome') { throw 'The target is not a Chrome window.' }
  $handle = [IntPtr]$target.id
  switch ($Action) {
    'focus' { [JarvisWindows]::Focus($handle) }
    'minimize' { [void][JarvisWindows]::ShowWindowAsync($handle,6) }
    'maximize' { [void][JarvisWindows]::ShowWindowAsync($handle,3) }
    'restore' { [void][JarvisWindows]::ShowWindowAsync($handle,9) }
    { $_ -in 'snap_left','snap_right' } {
      Add-Type -AssemblyName System.Windows.Forms
      $area = [Windows.Forms.Screen]::FromHandle($handle).WorkingArea
      [void][JarvisWindows]::ShowWindowAsync($handle,9)
      Start-Sleep -Milliseconds 120
      $half = [int][Math]::Floor($area.Width / 2)
      $left = $area.Left
      $width = $half
      if ($Action -eq 'snap_right') { $left += $half; $width = $area.Width - $half }
      if (![JarvisWindows]::MoveWindow($handle,$left,$area.Top,$width,$area.Height,$true)) { throw 'Windows refused to move that window.' }
    }
    'chrome_next' { [JarvisWindows]::Chord($handle, [ushort[]]@(0x11,0x22)) }
    'chrome_previous' { [JarvisWindows]::Chord($handle, [ushort[]]@(0x11,0x21)) }
    'chrome_close' {
      if ($target.title -match 'J\.?A\.?R\.?V\.?I\.?S\.?') { throw 'Jarvis is the selected tab. Select the tab you want to close first.' }
      [JarvisWindows]::Chord($handle, [ushort[]]@(0x11,0x57))
    }
    { $_.StartsWith('youtube_') } {
      # ponytail: English Chrome/YouTube accessibility labels; use a browser extension for other locales.
      [JarvisWindows]::Focus($handle)
      Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
      $root = [Windows.Automation.AutomationElement]::FromHandle($handle)
      $editCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
      $edits = $root.FindAll([Windows.Automation.TreeScope]::Descendants,$editCondition)
      $youtube = $false
      foreach ($edit in $edits) {
        if ($edit.Current.Name -notmatch 'address|search bar') { continue }
        $pattern = $null
        if ($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
          $url = $pattern.Current.Value
          if ($url -match '^(https?://)?(www\.)?youtube\.com/(watch|shorts/|live/)') { $youtube = $true; break }
        }
      }
      if (!$youtube) { throw 'Select a YouTube video tab first. Playback was not changed.' }
      $buttonCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
      $buttons = $root.FindAll([Windows.Automation.TreeScope]::Descendants,$buttonCondition)
      $play = $buttons | Where-Object { $_.Current.Name -eq 'Play (k)' } | Select-Object -First 1
      $pause = $buttons | Where-Object { $_.Current.Name -eq 'Pause (k)' } | Select-Object -First 1
      $button = if ($Action -eq 'youtube_play') { $play } elseif ($Action -eq 'youtube_pause') { $pause } elseif ($play) { $play } else { $pause }
      if ($button) { ($button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke() }
      elseif (!$play -and !$pause) { throw 'The YouTube player controls are unavailable. Open a video and try again.' }
    }
  }
  @{ ok=$true; action=$Action; windowId=$target.id; title=$target.title } | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }

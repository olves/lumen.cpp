// Taskbar identity (Electron): the right-click menu of the taskbar button shows the window's relaunch name and icon. Without
// them Windows falls back to the exe's own resources, which say "Electron" with the Electron logo (seen 8 Nov 2026). A small
// C# probe (compiled with Windows' .NET Framework compiler, like the test sd-server) reads the window's AppUserModel
// properties through SHGetPropertyStoreForWindow.
//   $env:LUMEN_SHELL='electron'; node --test tests/ui/taskbar.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, workRoot } from '../harness/launch.mjs';
import { prepareData } from './data.mjs';

const shell = process.env.LUMEN_SHELL || 'electron';
const runDir = path.join(workRoot, 'ui-tests', `taskbar-${shell}-` + new Date().toISOString().replace(/[:.]/g, '-'));
const PROBE = `
using System; using System.Diagnostics; using System.Runtime.InteropServices;
class Probe {
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public long pad1; [FieldOffset(16)] public long pad2; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); int Commit(); }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  static string Read(IPropertyStore s, uint pid) {
    var k = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = pid }; PROPVARIANT v;
    if (s.GetValue(ref k, out v) != 0 || v.vt != 31) return ""; return Marshal.PtrToStringUni(v.p);
  }
  static void Main(string[] args) {
    uint target = uint.Parse(args[0]); IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == target && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    if (found == IntPtr.Zero) { Console.WriteLine("{}"); return; }
    var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore s; SHGetPropertyStoreForWindow(found, ref iid, out s);
    Console.WriteLine("{\\"id\\":\\"" + Read(s, 5).Replace("\\\\", "\\\\\\\\") + "\\",\\"name\\":\\"" + Read(s, 4).Replace("\\\\", "\\\\\\\\") + "\\",\\"icon\\":\\"" + Read(s, 3).Replace("\\\\", "\\\\\\\\") + "\\",\\"command\\":\\"" + Read(s, 2).Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"}");
  }
}`;
let app, probe;

describe(`taskbar identity (${shell})`, { skip: shell === 'electron' ? false : 'Electron only (the Tauri shell is a preview)' }, () => {
  before(async () => {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'probe.cs'), PROBE);
    probe = path.join(runDir, 'probe.exe');
    const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', '/target:exe', '/out:' + probe, path.join(runDir, 'probe.cs')], { stdio: 'pipe' });
    prepareData(path.join(runDir, 'data'), null);
    app = await launch({ shell, dataDir: path.join(runDir, 'data') });
    await app.cdp.waitFor('state.ready === true', 30000);
  });
  after(async () => { await app?.stop(); });

  test('the taskbar menu shows lumen.cpp with the Lumen icon, not Electron', async () => {
    let r = {};
    for (let i = 0; i < 20 && !r.name; i++) { r = JSON.parse(execFileSync(probe, [String(app.process.pid)], { encoding: 'utf8' }).trim() || '{}'); if (!r.name) await new Promise(res => setTimeout(res, 250)); }
    assert.equal(r.id, 'Lumen.Beta.Desktop');
    assert.equal(r.name, 'lumen.cpp');
    assert.match(r.icon, /lumen\.ico(,0)?$/i);
    assert.ok(fs.existsSync(r.icon.replace(/,\d+$/, '')), 'icon file exists: ' + r.icon);
    assert.match(r.command, /lumen\.cpp\.exe|electron\.exe/i, 'relaunch starts the app itself');
  });
});

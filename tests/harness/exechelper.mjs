// Builds backend/lumen-exec.exe from app/backend/LumenExec.cs for tests (binaries are not in the repository). Output goes to
// work/bin and, when they exist, the Electron dev copy and the Tauri build backends, so UI tests get the helper too. Rebuilt when the source is newer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(repo, 'app', 'backend', 'LumenExec.cs');
const work = path.resolve(repo, '..', 'work');
const SMA = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Management.Automation', 'v4.0_3.0.0.0__31bf3856ad364e35', 'System.Management.Automation.dll');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

function build(out) {
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(source).mtimeMs) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(csc, ['/nologo', '/target:exe', `/out:${out}`, '/r:System.Web.Extensions.dll', `/r:${SMA}`, source], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('lumen-exec.exe did not compile:\n' + r.stdout + r.stderr);
  return out;
}

export function execHelper() {
  const out = build(path.join(work, 'bin', 'lumen-exec.exe'));
  const dev = path.join(work, 'electron-dev', 'resources', 'app', 'backend');
  if (fs.existsSync(dev)) fs.copyFileSync(out, path.join(dev, 'lumen-exec.exe'));
  const tauri = path.join(work, 'tauri-build', 'backend');
  if (fs.existsSync(path.join(tauri, 'lumen-host.exe'))) fs.copyFileSync(out, path.join(tauri, 'lumen-exec.exe'));
  return out;
}

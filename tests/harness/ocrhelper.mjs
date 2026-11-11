// Builds backend/lumen-image-ocr.exe from app/backend/ImageOcr.cs for tests (binaries are not in the repository) into work/bin, and
// copies it into the Electron dev copy and the Tauri build backends when they exist. Rebuilt when the source is newer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(repo, 'app', 'backend', 'ImageOcr.cs');
const work = path.resolve(repo, '..', 'work');
const win = process.env.WINDIR || 'C:\\Windows', wm = path.join(win, 'System32', 'WinMetadata'), fw = path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319');

export function ocrHelper() {
  const out = path.join(work, 'bin', 'lumen-image-ocr.exe');
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const refs = ['Windows.Foundation', 'Windows.Storage', 'Windows.Graphics', 'Windows.Media', 'Windows.Globalization', 'Windows.Data'].map(n => `/r:${path.join(wm, n + '.winmd')}`);
    const r = spawnSync(path.join(fw, 'csc.exe'), ['/nologo', '/target:exe', `/out:${out}`, ...refs, `/r:${path.join(fw, 'System.Runtime.WindowsRuntime.dll')}`, `/r:${path.join(fw, 'System.Web.Extensions.dll')}`, '/r:System.Runtime.dll', '/r:System.Threading.Tasks.dll', source], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('lumen-image-ocr.exe did not compile:\n' + r.stdout + r.stderr);
  }
  for (const dir of [path.join(work, 'electron-dev', 'resources', 'app', 'backend'), path.join(work, 'tauri-build', 'backend')]) {
    if (!fs.existsSync(path.join(dir, 'lumen-host.exe'))) continue;
    const target = path.join(dir, 'lumen-image-ocr.exe');
    try { fs.copyFileSync(out, target); } catch { try { fs.renameSync(target, target + '.old'); fs.copyFileSync(out, target); } catch {} }
  }
  return out;
}

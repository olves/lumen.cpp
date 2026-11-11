// Makes tests/fixtures/scanned.pdf: one A4 page that is only a JPEG picture of text (no text layer), like a scanner's output.
// The picture is drawn with .NET System.Drawing through PowerShell; the PDF around it is written by hand (one DCTDecode image).
//   node tests/fixtures/make-scanned-pdf.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const jpg = path.join(os.tmpdir(), 'lumen-scanned-' + process.pid + '.jpg');
const ps = `Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap 1240, 1754
$g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$f = New-Object System.Drawing.Font('Arial', 30)
$lines = @('Invoice number 4471', 'Customer: Marlow Lantern Society', 'Total amount: 1250 EUR', 'Payment due in 30 days')
for ($i = 0; $i -lt $lines.Count; $i++) { $g.DrawString($lines[$i], $f, [System.Drawing.Brushes]::Black, 120, 200 + $i * 90) }
$b.Save('${jpg.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Jpeg)`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) throw new Error(r.stderr);
const image = fs.readFileSync(jpg); fs.unlinkSync(jpg);

const objects = [];
const add = body => { objects.push(body); return objects.length; };
add('<< /Type /Catalog /Pages 2 0 R >>');
add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>');
add({ head: `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>`, data: image });
const draw = Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q');
add({ head: `<< /Length ${draw.length} >>`, data: draw });

const parts = [Buffer.from('%PDF-1.4\n')], offsets = [];
let size = parts[0].length;
objects.forEach((o, i) => {
  offsets.push(size);
  const chunk = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`) : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.head}\nstream\n`), o.data, Buffer.from('\nendstream\nendobj\n')]);
  parts.push(chunk); size += chunk.length;
});
const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
parts.push(Buffer.from(xref));
fs.writeFileSync(path.join(here, 'scanned.pdf'), Buffer.concat(parts));
console.log('scanned.pdf', Buffer.concat(parts).length, 'bytes');

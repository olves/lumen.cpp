'use strict';
// Release helper, run with Electron as Node (see release.ps1):
//   keygen <private.pem> <public.pem>         create the Ed25519 update signing key (refuses to overwrite)
//   manifest <out.json> <build> <version> <notes-en> <notes-tr> <zip> <setup>
//                                             write lumen-update.json for the two release files
//   sign <private.pem> <file>                 write <file>.sig (base64 Ed25519 signature of the exact bytes)
//   verify <public.pem> <file>                check <file>.sig
// Results go to <file>.result.json-style files or the exit code, because Electron does not attach to the console.
const fs = require('node:fs'), crypto = require('node:crypto'), path = require('node:path');
const [command, ...args] = process.argv.slice(2).filter(a => a !== '--');
const sha256 = file => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
const fail = message => { fs.writeFileSync(path.join(process.env.TEMP || '.', 'lumen-release-tool.error'), message); process.exit(1); };

(async () => {
  if (command === 'keygen') {
    const [privatePath, publicPath] = args;
    if (fs.existsSync(privatePath)) fail('A signing key already exists: ' + privatePath);
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx' });
    fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  } else if (command === 'manifest') {
    const [out, build, version, notesEn, notesTr, zip, setup] = args;
    if (!/^\d+$/.test(build)) fail('Build must be a number.');
    const asset = async file => ({ name: path.basename(file), size: fs.statSync(file).size, sha256: await sha256(file) });
    const manifest = { product: 'lumen.cpp', channel: 'beta', build: Number(build), version, published: new Date().toISOString(),
      notes: { en: notesEn || '', tr: notesTr || '' }, assets: { zip: await asset(zip), setup: await asset(setup) } };
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  } else if (command === 'sign') {
    const [privatePath, file] = args;
    const key = crypto.createPrivateKey(fs.readFileSync(privatePath));
    fs.writeFileSync(file + '.sig', crypto.sign(null, fs.readFileSync(file), key).toString('base64') + '\n');
  } else if (command === 'verify') {
    const [publicPath, file] = args;
    const ok = crypto.verify(null, fs.readFileSync(file), crypto.createPublicKey(fs.readFileSync(publicPath)), Buffer.from(fs.readFileSync(file + '.sig', 'utf8').trim(), 'base64'));
    if (!ok) fail('Signature does not match.');
  } else fail('Unknown command: ' + command);
})().catch(error => fail(error.stack || String(error)));

'use strict';
// Sensitive data in a message (v1.2, ROADMAP-v1.2.md M6-G). Checked on this computer before a message goes to a cloud model; a
// local model gets no warning (nothing leaves the PC). Each finding is validated to keep false alarms rare: card numbers by the
// Luhn sum, Turkish ID numbers by their two check digits, IBANs by mod 97; keys by their well-known prefixes.
//   findSensitive(text) -> [{kind: 'card'|'tckn'|'iban'|'key'|'private-key'|'password', masked}]
// Loaded as a renderer script (lumenui.js uses it) and required by the core tests.
(function (root) {
  function luhn(digits) { let sum = 0; for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) { let d = +digits[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; }
  function tckn(d) {
    if (!/^[1-9]\d{10}$/.test(d)) return false;
    const n = [...d].map(Number), odd = n[0] + n[2] + n[4] + n[6] + n[8], even = n[1] + n[3] + n[5] + n[7];
    return ((odd * 7 - even) % 10 + 10) % 10 === n[9] && n.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === n[10];
  }
  function iban(s) {
    const t = s.replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(t)) return false;
    const moved = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
    let rest = 0; for (const ch of moved) rest = (rest * 10 + +ch) % 97; return rest === 1;
  }
  const mask = s => { const t = String(s).replace(/\s+/g, ''); return t.length <= 8 ? '••••' : t.slice(0, 4) + '…' + t.slice(-4); };
  const KEYS = [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, /\bhf_[A-Za-z0-9]{30,}\b/];

  function findSensitive(text) {
    const s = String(text || ''), out = [], seen = new Set();
    const add = (kind, value) => { const key = kind + value.replace(/\s+/g, ''); if (!seen.has(key)) { seen.add(key); out.push({ kind, masked: mask(value) }); } };
    for (const m of s.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d)) add('card', m[0]); }
    for (const m of s.matchAll(/\b\d{11}\b/g)) if (tckn(m[0])) add('tckn', m[0]);
    // Also lower case ("tr33 0006 …"); iban() upper-cases before the mod-97 check.
    for (const m of s.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/gi)) if (iban(m[0])) add('iban', m[0]);
    for (const re of KEYS) for (const m of s.matchAll(new RegExp(re.source, 'g'))) add('key', m[0]);
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/.test(s)) add('private-key', 'PRIVATE KEY');
    // \b does not see "ş" as a letter, so the word start is checked with Unicode letter classes.
    for (const m of s.matchAll(/(?<![\p{L}\p{N}])(?:password|passwd|parola|şifre(?:m)?)\s*[:=]\s*(\S{6,})/giu)) add('password', m[1]);
    return out;
  }
  const api = { findSensitive, luhn, tckn, iban };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.lumenSensitive = api;
})(typeof window !== 'undefined' ? window : globalThis);

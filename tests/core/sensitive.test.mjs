// sensitive.js: what counts as sensitive before a message goes to a cloud model. Validated numbers only, to keep false alarms rare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { findSensitive } = createRequire(import.meta.url)('../../app/sensitive.js');
const kinds = t => findSensitive(t).map(x => x.kind);

test('cards with a valid Luhn sum, Turkish ID numbers, IBANs, API keys, private keys and passwords are found and masked', () => {
  assert.deepEqual(kinds('Kartım 4111 1111 1111 1111, son kullanma 12/29'), ['card']);
  assert.equal(findSensitive('4111111111111111')[0].masked, '4111…1111');
  assert.deepEqual(kinds('TC kimlik no: 10000000146'), ['tckn']);
  assert.deepEqual(kinds('IBAN: TR33 0006 1005 1978 6457 8413 26'), ['iban']);
  assert.deepEqual(kinds('GB82WEST12345698765432'), ['iban']);
  assert.deepEqual(kinds('key = sk-proj-abcdefghijklmnopqrstuvwxyz123456'), ['key']);
  assert.deepEqual(kinds('token ghp_' + 'a'.repeat(36)), ['key']);
  assert.deepEqual(kinds('-----BEGIN OPENSSH PRIVATE KEY-----\nabc'), ['private-key']);
  assert.deepEqual(kinds('şifre: Gizli1234!'), ['password']);
});

test('review 12 Nov: a lower-case IBAN is found too', () => {
  assert.deepEqual(kinds('ibanım tr33 0006 1005 1978 6457 8413 26'), ['iban']);
});

test('ordinary numbers and text are not flagged', () => {
  for (const t of ['Order 1234567890123 shipped', 'Call 0532 123 45 67', 'Total 4111 1111 1111 1112', '12345678901 is not an ID',
    'IBAN TR00 0000 0000 0000 0000 0000 00', 'The sk-learn library', 'password reset link', 'Version 2026.11.12.1', '11111111111111111'])
    assert.deepEqual(kinds(t), [], t);
});

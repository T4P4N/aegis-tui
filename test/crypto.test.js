'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  base32Decode,
  base32Encode,
  generateHOTP,
  generateTOTP,
  getRemainingSeconds,
  decryptVault
} = require('../src/crypto');

test('Base32 encode & decode', () => {
  const vectors = [
    { text: '', base32: '' },
    { text: 'f', base32: 'MY======' },
    { text: 'fo', base32: 'MZXQ====' },
    { text: 'foo', base32: 'MZXW6===' },
    { text: 'foob', base32: 'MZXW6YQ=' },
    { text: 'fooba', base32: 'MZXW6YTB' },
    { text: 'foobar', base32: 'MZXW6YTBOI======' }
  ];

  for (const v of vectors) {
    const encoded = base32Encode(Buffer.from(v.text, 'utf8'));
    assert.equal(encoded, v.base32);
    const decoded = base32Decode(v.base32).toString('utf8');
    assert.equal(decoded, v.text);
  }
});

test('RFC 4226 HOTP test vectors', () => {
  // Secret: 12345678901234567890 (ASCII)
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const expectedCodes = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489'
  ];

  for (let counter = 0; counter < expectedCodes.length; counter++) {
    const code = generateHOTP(secret, counter, { digits: 6, algo: 'SHA1' });
    assert.equal(code, expectedCodes[counter], `HOTP mismatch at counter ${counter}`);
  }
});

test('RFC 6238 TOTP test vectors', () => {
  const secretSha1 = Buffer.from('12345678901234567890', 'ascii');
  const secretSha256 = Buffer.from('12345678901234567890123456789012', 'ascii');
  const secretSha512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii');

  // Time = 59s
  assert.equal(generateTOTP(secretSha1, { digits: 8, period: 30, algo: 'SHA1', timestamp: 59 }), '94287082');

  // Time = 1111111109s
  assert.equal(generateTOTP(secretSha1, { digits: 8, period: 30, algo: 'SHA1', timestamp: 1111111109 }), '07081804');
  assert.equal(generateTOTP(secretSha256, { digits: 8, period: 30, algo: 'SHA256', timestamp: 1111111109 }), '68084774');
  assert.equal(generateTOTP(secretSha512, { digits: 8, period: 30, algo: 'SHA512', timestamp: 1111111109 }), '25091201');
});

test('Remaining seconds calculation', () => {
  assert.equal(getRemainingSeconds(30, 0), 30);
  assert.equal(getRemainingSeconds(30, 1), 29);
  assert.equal(getRemainingSeconds(30, 29), 1);
  assert.equal(getRemainingSeconds(30, 30), 30);
  assert.equal(getRemainingSeconds(30, 45), 15);
});

test('Steam Guard OTP generation', () => {
  // Steam uses 5 alphanumeric characters
  const secret = 'JRZCL47CMXVOQMNPZR2F7J4RGI';
  const code = generateTOTP(secret, { digits: 5, period: 30, algo: 'SHA1', isSteam: true, timestamp: 100000 });
  assert.equal(typeof code, 'string');
  assert.equal(code.length, 5);
  assert.match(code, /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
});

test('Encrypted vault decryption with scrypt and AES-256-GCM', () => {
  const encPath = path.join(__dirname, '../samples/aegis_encrypted.json');
  const raw = JSON.parse(fs.readFileSync(encPath, 'utf8'));

  const db = decryptVault(raw, 'test');
  assert.ok(db);
  assert.equal(db.version, 1);
  assert.equal(Array.isArray(db.entries), true);
  assert.equal(db.entries.length, 7);

  // Wrong password should fail
  assert.throws(() => {
    decryptVault(raw, 'wrong-password');
  }, /Incorrect password/);
});

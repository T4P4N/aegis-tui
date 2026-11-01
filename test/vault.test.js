'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadVault, isVaultEncrypted, parseVaultDb } = require('../src/vault');

test('isVaultEncrypted detection', () => {
  assert.equal(isVaultEncrypted(null), false);
  assert.equal(isVaultEncrypted({}), false);
  assert.equal(isVaultEncrypted({ header: { slots: [] }, db: {} }), false);
  assert.equal(isVaultEncrypted({ header: { slots: [{ type: 1 }] }, db: 'base64ciphertext' }), true);
});

test('Load plaintext Aegis vault', () => {
  const plainPath = path.join(__dirname, '../samples/aegis_plain.json');
  const res = loadVault(plainPath);

  assert.equal(res.isEncrypted, false);
  assert.equal(Array.isArray(res.entries), true);
  assert.equal(res.entries.length, 7);

  const deno = res.entries.find(e => e.issuer === 'Deno');
  assert.ok(deno);
  assert.equal(deno.name, 'Mason');
  assert.equal(deno.type, 'totp');
  assert.equal(deno.digits, 6);
  assert.equal(deno.period, 30);
  assert.equal(deno.algo, 'SHA1');
  assert.equal(deno.secret, '4SJHB4GSD43FZBAI7C2HLRJGPQ');
});

test('Load encrypted Aegis vault with correct password', () => {
  const encPath = path.join(__dirname, '../samples/aegis_encrypted.json');
  const res = loadVault(encPath, 'test');

  assert.equal(res.isEncrypted, true);
  assert.equal(res.entries.length, 7);
});

test('Load encrypted Aegis vault requires password', () => {
  const encPath = path.join(__dirname, '../samples/aegis_encrypted.json');
  assert.throws(() => {
    loadVault(encPath);
  }, { code: 'PASSWORD_REQUIRED' });
});

test('Normalizes groups and favorites', () => {
  const db = {
    version: 3,
    groups: [
      { uuid: 'group-1', name: 'Work' }
    ],
    entries: [
      {
        type: 'totp',
        name: 'user@work.com',
        issuer: 'Zendesk',
        favorite: false,
        groups: ['group-1'],
        info: { secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        name: 'user@home.com',
        issuer: 'Alpha',
        favorite: true,
        info: { secret: 'JBSWY3DPEHPK3PXP', digits: 6, period: 30 }
      }
    ]
  };

  const parsed = parseVaultDb(db);
  assert.equal(parsed.length, 2);
  // Favorite should be sorted first
  assert.equal(parsed[0].issuer, 'Alpha');
  assert.equal(parsed[0].favorite, true);
  assert.equal(parsed[1].issuer, 'Zendesk');
  assert.deepEqual(parsed[1].groups, ['Work']);
});

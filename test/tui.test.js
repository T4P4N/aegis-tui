'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadVault } = require('../src/vault');
const { AegisTui, formatOtp, stripAnsi, padTrunc } = require('../src/tui');

test('formatOtp helper formats codes correctly', () => {
  assert.equal(formatOtp('123456'), '123 456');
  assert.equal(formatOtp('1234567'), '123 4567');
  assert.equal(formatOtp('12345678'), '1234 5678');
  assert.equal(formatOtp('ABCDE'), 'ABCDE');
  assert.equal(formatOtp(''), '------');
});

test('padTrunc correctly pads and truncates with ANSI codes', () => {
  const plain = padTrunc('Hello', 10);
  assert.equal(plain, 'Hello     ');
  assert.equal(stripAnsi(plain).length, 10);

  const long = padTrunc('A very long text that exceeds limit', 10);
  assert.equal(stripAnsi(long).length, 10);
  assert.ok(stripAnsi(long).endsWith('…'));
});

test('AegisTui filtering works as expected', () => {
  const plainPath = path.join(__dirname, '../samples/aegis_plain.json');
  const vaultData = loadVault(plainPath);
  const tui = new AegisTui(vaultData, { fileName: 'aegis_plain.json' });

  // All entries initially
  assert.equal(tui.getFilteredEntries().length, 7);

  // Search by issuer
  tui.searchQuery = 'deno';
  const denoMatches = tui.getFilteredEntries();
  assert.equal(denoMatches.length, 1);
  assert.equal(denoMatches[0].issuer, 'Deno');

  // Search by name
  tui.searchQuery = 'james';
  const jamesMatches = tui.getFilteredEntries();
  assert.equal(jamesMatches.length, 2);

  // Search with no matches
  tui.searchQuery = 'nonexistent-service-12345';
  assert.equal(tui.getFilteredEntries().length, 0);
});

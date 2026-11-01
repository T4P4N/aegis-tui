'use strict';

const fs = require('fs');
const path = require('path');
const { decryptVault } = require('./crypto');

class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

/**
 * Checks if a parsed vault JSON object is encrypted.
 *
 * @param {object} json
 * @returns {boolean}
 */
function isVaultEncrypted(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.header && Array.isArray(json.header.slots) && json.header.slots.length > 0) {
    return typeof json.db === 'string';
  }
  return false;
}

/**
 * Extracts and maps group UUIDs to names.
 *
 * @param {object} dbJson
 * @returns {Map<string, string>}
 */
function buildGroupMap(dbJson) {
  const map = new Map();
  if (Array.isArray(dbJson.groups)) {
    for (const g of dbJson.groups) {
      if (g && g.uuid && g.name) {
        map.set(g.uuid, g.name);
      }
    }
  }
  return map;
}

/**
 * Normalizes an entry from Aegis vault into a consistent model.
 *
 * @param {object} raw
 * @param {Map<string, string>} groupMap
 * @returns {object}
 */
function normalizeEntry(raw, groupMap) {
  const type = (raw.type || 'totp').toLowerCase();
  const info = raw.info || raw.config || {};

  // Groups resolution
  const resolvedGroups = [];
  if (Array.isArray(raw.groups)) {
    for (const gid of raw.groups) {
      resolvedGroups.push(groupMap.get(gid) || gid);
    }
  } else if (raw.group) {
    resolvedGroups.push(groupMap.get(raw.group) || raw.group);
  }

  const digits = Number(info.digits) || (type === 'steam' ? 5 : 6);
  const period = Number(info.period) || 30;
  const algo = (info.algo || 'SHA1').toUpperCase();
  const secret = (info.secret || '').trim();

  return {
    uuid: raw.uuid || '',
    type, // 'totp', 'hotp', 'steam', etc.
    name: raw.name || '',
    issuer: raw.issuer || '',
    note: raw.note || (raw.info && raw.info.notes) || '',
    favorite: Boolean(raw.favorite),
    groups: resolvedGroups,
    secret,
    digits,
    period,
    algo,
    counter: info.counter !== undefined ? Number(info.counter) : 0
  };
}

/**
 * Parses inner Aegis database object into clean entry list.
 *
 * @param {object} dbJson
 * @returns {Array<object>}
 */
function parseVaultDb(dbJson) {
  if (!dbJson || !Array.isArray(dbJson.entries)) {
    throw new VaultError('Vault database is missing "entries" list', 'INVALID_DB');
  }

  const groupMap = buildGroupMap(dbJson);
  const entries = dbJson.entries.map(e => normalizeEntry(e, groupMap));

  // Sort: favorites first, then by issuer (case-insensitive), then by name
  entries.sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }
    const issuerA = (a.issuer || a.name || '').toLowerCase();
    const issuerB = (b.issuer || b.name || '').toLowerCase();
    const comp = issuerA.localeCompare(issuerB);
    if (comp !== 0) return comp;
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  });

  return entries;
}

/**
 * Loads an Aegis vault file from path, handling plaintext and encrypted formats.
 *
 * @param {string} filePath
 * @param {string} [password]
 * @returns {{ entries: Array<object>, isEncrypted: boolean, version: number }}
 */
function loadVault(filePath, password = null) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new VaultError(`Vault file not found at: ${resolvedPath}`, 'FILE_NOT_FOUND');
  }

  let content;
  try {
    content = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new VaultError(`Failed to read file: ${err.message}`, 'READ_ERROR');
  }

  let json;
  try {
    json = JSON.parse(content);
  } catch (err) {
    throw new VaultError(`Failed to parse JSON: ${err.message}`, 'JSON_PARSE_ERROR');
  }

  const encrypted = isVaultEncrypted(json);

  let db;
  if (encrypted) {
    if (!password) {
      throw new VaultError('This vault is encrypted and requires a password to open', 'PASSWORD_REQUIRED');
    }
    try {
      db = decryptVault(json, password);
    } catch (err) {
      throw new VaultError(err.message, 'DECRYPT_FAILED');
    }
  } else {
    // Plaintext vault: either standard container { version: 1, header: ..., db: { entries: [] } }
    // or directly the inner db { entries: [] }
    db = json.db && typeof json.db === 'object' ? json.db : json;
  }

  const entries = parseVaultDb(db);
  return {
    entries,
    isEncrypted: encrypted,
    version: json.version || (db && db.version) || 1
  };
}

module.exports = {
  isVaultEncrypted,
  parseVaultDb,
  loadVault,
  VaultError
};

'use strict';

const crypto = require('crypto');

/**
 * Base32 character set (RFC 4648)
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Steam Guard OTP character set
 */
const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

/**
 * Decodes a base32 encoded string into a Buffer.
 * Handles padding ('=') and whitespace gracefully.
 *
 * @param {string} input - Base32 string
 * @returns {Buffer}
 */
function base32Decode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Base32 input must be a string');
  }

  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character found: "${char}"`);
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Encodes a buffer to Base32 string (with padding)
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  while (output.length % 8 !== 0) {
    output += '=';
  }

  return output;
}

/**
 * Normalizes algorithm name to Node crypto HMAC digest name.
 * e.g., 'SHA1' -> 'sha1', 'SHA256' -> 'sha256', 'SHA512' -> 'sha512'
 */
function normalizeAlgo(algo) {
  if (!algo) return 'sha1';
  const clean = algo.trim().toLowerCase().replace('-', '');
  if (clean === 'sha1' || clean === 'sha256' || clean === 'sha512') {
    return clean;
  }
  return 'sha1';
}

/**
 * Generates an OTP code using HOTP (RFC 4226) or Steam variant.
 *
 * @param {string|Buffer} secret - Base32 string or raw key Buffer
 * @param {number|bigint} counter - Counter value
 * @param {object} [options]
 * @param {number} [options.digits=6]
 * @param {string} [options.algo='SHA1']
 * @param {boolean} [options.isSteam=false]
 * @returns {string}
 */
function generateHOTP(secret, counter, options = {}) {
  const {
    digits = 6,
    algo = 'SHA1',
    isSteam = false
  } = options;

  const keyBuffer = Buffer.isBuffer(secret) ? secret : base32Decode(secret);

  // Big-endian 64-bit counter representation
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(normalizeAlgo(algo), keyBuffer);
  hmac.update(counterBuf);
  const digest = hmac.digest();

  // Dynamic Truncation (RFC 4226 section 5.4)
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  if (isSteam) {
    let fullCode = binary;
    let steamCode = '';
    const steamDigits = digits || 5;
    for (let i = 0; i < steamDigits; i++) {
      steamCode += STEAM_ALPHABET[fullCode % STEAM_ALPHABET.length];
      fullCode = Math.floor(fullCode / STEAM_ALPHABET.length);
    }
    return steamCode;
  }

  const code = (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
  return code;
}

/**
 * Generates a TOTP code (RFC 6238) for a given timestamp.
 *
 * @param {string|Buffer} secret - Base32 secret or Buffer
 * @param {object} [options]
 * @param {number} [options.digits=6]
 * @param {number} [options.period=30]
 * @param {string} [options.algo='SHA1']
 * @param {boolean} [options.isSteam=false]
 * @param {number} [options.timestamp] - Unix timestamp in seconds (default: Date.now() / 1000)
 * @returns {string}
 */
function generateTOTP(secret, options = {}) {
  const {
    period = 30,
    timestamp = Math.floor(Date.now() / 1000)
  } = options;

  const counter = Math.floor(timestamp / period);
  return generateHOTP(secret, counter, options);
}

/**
 * Calculates remaining seconds in current TOTP cycle.
 *
 * @param {number} [period=30]
 * @param {number} [timestamp] - Current timestamp in seconds
 * @returns {number}
 */
function getRemainingSeconds(period = 30, timestamp = Math.floor(Date.now() / 1000)) {
  const elapsed = timestamp % period;
  return period - elapsed;
}

/**
 * Decrypts an encrypted Aegis vault container.
 *
 * @param {object} vaultJson - Parsed JSON of the vault file
 * @param {string} password - User provided password
 * @returns {object} Decrypted inner database object
 */
function decryptVault(vaultJson, password) {
  if (!vaultJson || !vaultJson.header) {
    throw new Error('Invalid Aegis vault format: missing header');
  }

  const { slots, params } = vaultJson.header;
  if (!Array.isArray(slots) || !params) {
    throw new Error('Vault is not encrypted or header parameters are missing');
  }

  // Type 1 is password slot
  const passwordSlot = slots.find(s => s.type === 1);
  if (!passwordSlot) {
    throw new Error('No password slot found in vault. Only password-unlocked vaults are supported.');
  }

  const salt = Buffer.from(passwordSlot.salt, 'hex');
  const n = passwordSlot.n || 32768;
  const r = passwordSlot.r || 8;
  const p = passwordSlot.p || 1;

  // Derive slot key via scrypt
  let derivedKey;
  try {
    derivedKey = crypto.scryptSync(password, salt, 32, {
      N: n,
      r: r,
      p: p,
      maxmem: 128 * 1024 * 1024
    });
  } catch (err) {
    throw new Error(`Scrypt key derivation failed: ${err.message}`);
  }

  // Decrypt master key using slot key (AES-256-GCM)
  let masterKey;
  try {
    const slotNonce = Buffer.from(passwordSlot.key_params.nonce, 'hex');
    const slotTag = Buffer.from(passwordSlot.key_params.tag, 'hex');
    const encryptedKey = Buffer.from(passwordSlot.key, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, slotNonce);
    decipher.setAuthTag(slotTag);
    const decrypted1 = decipher.update(encryptedKey);
    const decrypted2 = decipher.final();
    masterKey = Buffer.concat([decrypted1, decrypted2]);
  } catch (err) {
    throw new Error('Incorrect password or corrupted key slot');
  }

  // Decrypt vault database content (AES-256-GCM)
  let decryptedDbStr;
  try {
    const dbNonce = Buffer.from(params.nonce, 'hex');
    const dbTag = Buffer.from(params.tag, 'hex');
    const ciphertext = Buffer.from(vaultJson.db, 'base64');

    const dbDecipher = crypto.createDecipheriv('aes-256-gcm', masterKey, dbNonce);
    dbDecipher.setAuthTag(dbTag);
    let decrypted = dbDecipher.update(ciphertext, undefined, 'utf8');
    decrypted += dbDecipher.final('utf8');
    decryptedDbStr = decrypted;
  } catch (err) {
    throw new Error('Failed to decrypt vault database content');
  }

  try {
    return JSON.parse(decryptedDbStr);
  } catch (err) {
    throw new Error('Decrypted content is not valid JSON');
  }
}

module.exports = {
  base32Decode,
  base32Encode,
  generateHOTP,
  generateTOTP,
  getRemainingSeconds,
  decryptVault
};

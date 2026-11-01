#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadVault, isVaultEncrypted, VaultError } = require('../src/vault');
const { AegisTui } = require('../src/tui');
const pkg = require('../package.json');

function printHelp() {
  console.log(`
${'\x1b[1m\x1b[36m'}Aegis TUI${'\x1b[0m'} - Terminal Authenticator for Aegis Vaults (v${pkg.version})

${'\x1b[1m'}USAGE:${'\x1b[0m'}
  aegis-tui [options] [path/to/aegis_export.json]

${'\x1b[1m'}ARGUMENTS:${'\x1b[0m'}
  [vault.json]          Path to exported Aegis JSON vault (plain or encrypted)

${'\x1b[1m'}OPTIONS:${'\x1b[0m'}
  -p, --password <pwd>  Password to decrypt the vault (if encrypted)
  -h, --help            Show this help message
  -v, --version         Show version information

${'\x1b[1m'}KEYBOARD SHORTCUTS IN TUI:${'\x1b[0m'}
  ↑ / ↓ / j / k         Navigate through entries
  Enter / c / Space     Copy current OTP code to clipboard
  /                     Start searching / filtering
  Esc                   Exit search / clear filter
  q / Ctrl+C            Quit

${'\x1b[1m'}ENVIRONMENT VARIABLES:${'\x1b[0m'}
  AEGIS_PASSWORD        Default password for encrypted vaults
`);
}

/**
 * Prompts user for a masked password in terminal.
 */
function promptPassword(promptText = 'Enter vault password: ') {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      let buffer = '';
      const onData = (chunk) => {
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          stdin.removeListener('data', onData);
          resolve(buffer.slice(0, newlineIdx).replace(/\r$/, ''));
        }
      };
      stdin.on('data', onData);
      stdin.resume();
      return;
    }

    let password = '';
    process.stdout.write(promptText);

    stdin.setRawMode(true);
    stdin.resume();

    const onData = (chunk) => {
      const str = chunk.toString();
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          process.stdout.write('\n');
          resolve(password);
          return;
        } else if (char === '\u0003') {
          // Ctrl+C
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        } else if (char === '\u007f' || char === '\b') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          password += char;
          process.stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Auto-detects vault files in the current working directory.
 */
function findDefaultVaultFile() {
  const cwd = process.cwd();
  try {
    const files = fs.readdirSync(cwd);
    const matches = files.filter(f =>
      f.toLowerCase().endsWith('.json') &&
      (f.toLowerCase().includes('aegis') || f.toLowerCase().includes('vault'))
    );
    if (matches.length > 0) {
      return path.join(cwd, matches[0]);
    }
  } catch (_) {}
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  let vaultPath = null;
  let password = process.env.AEGIS_PASSWORD || null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
      console.log(`aegis-tui v${pkg.version}`);
      process.exit(0);
    }
    if (arg === '-p' || arg === '--password') {
      password = args[++i];
      continue;
    }
    if (!arg.startsWith('-') && !vaultPath) {
      vaultPath = arg;
    }
  }

  if (!vaultPath) {
    const autoDetected = findDefaultVaultFile();
    if (autoDetected) {
      vaultPath = autoDetected;
      console.log(`\x1b[36mFound vault file:\x1b[0m ${path.basename(vaultPath)}`);
    } else {
      console.error('\x1b[31mError: No Aegis vault JSON file specified.\x1b[0m\n');
      printHelp();
      process.exit(1);
    }
  }

  const resolvedPath = path.resolve(vaultPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`\x1b[31mError: File not found:\x1b[0m ${resolvedPath}`);
    process.exit(1);
  }

  // Pre-check if vault is encrypted
  let fileContent;
  let fileJson;
  try {
    fileContent = fs.readFileSync(resolvedPath, 'utf8');
    fileJson = JSON.parse(fileContent);
  } catch (err) {
    console.error(`\x1b[31mError reading JSON:\x1b[0m ${err.message}`);
    process.exit(1);
  }

  const isEncrypted = isVaultEncrypted(fileJson);

  if (isEncrypted && !password) {
    password = await promptPassword(`\x1b[33m🔑 Vault is encrypted.\x1b[0m Enter password: `);
    if (!password) {
      console.error('\x1b[31mError: Password cannot be empty for encrypted vault.\x1b[0m');
      process.exit(1);
    }
  }

  let vaultData;
  try {
    vaultData = loadVault(resolvedPath, password);
  } catch (err) {
    console.error(`\x1b[31mFailed to open vault:\x1b[0m ${err.message}`);
    process.exit(1);
  }

  if (vaultData.entries.length === 0) {
    console.log('\x1b[33mWarning: This vault has no entries.\x1b[0m');
  }

  // Launch TUI
  const tui = new AegisTui(vaultData, {
    fileName: path.basename(resolvedPath)
  });

  tui.start();
}

main().catch(err => {
  console.error('\x1b[31mUnexpected error:\x1b[0m', err);
  process.exit(1);
});

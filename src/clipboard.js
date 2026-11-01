'use strict';

const { spawn } = require('child_process');

/**
 * Copies text to system clipboard.
 * Attempts native platform tools first, and sends OSC 52 escape code as universal fallback.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }

  // 1. Send OSC 52 escape sequence (works across modern terminals & SSH)
  try {
    const base64 = Buffer.from(text, 'utf8').toString('base64');
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
  } catch (_) {
    // ignore
  }

  // 2. Try OS-specific clipboard commands
  const platform = process.platform;
  let command = null;
  let args = [];

  if (platform === 'linux') {
    // Check if Wayland or X11
    if (process.env.WAYLAND_DISPLAY) {
      command = 'wl-copy';
      args = [];
    } else {
      command = 'xclip';
      args = ['-selection', 'clipboard'];
    }
  } else if (platform === 'darwin') {
    command = 'pbcopy';
    args = [];
  } else if (platform === 'win32') {
    command = 'clip';
    args = [];
  }

  if (!command) {
    return true;
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => {
        // Fallback: if wl-copy failed, try xclip; or vice versa
        if (command === 'wl-copy') {
          try {
            const fallback = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
            fallback.on('error', () => resolve(true));
            fallback.stdin.write(text);
            fallback.stdin.end();
            return resolve(true);
          } catch (_) {
            return resolve(true);
          }
        }
        resolve(true);
      });
      child.stdin.write(text);
      child.stdin.end();
      child.on('close', () => resolve(true));
    } catch (_) {
      resolve(true);
    }
  });
}

module.exports = {
  copyToClipboard
};

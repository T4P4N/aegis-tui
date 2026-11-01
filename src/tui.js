'use strict';

const readline = require('readline');
const { generateTOTP, generateHOTP, getRemainingSeconds } = require('./crypto');
const { copyToClipboard } = require('./clipboard');

// ANSI Color and formatting codes
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
  bgDarkGray: '\x1b[100m',
  bgSelected: '\x1b[48;5;238m',

  // Screen control
  altScreenOn: '\x1b[?1049h',
  altScreenOff: '\x1b[?1049l',
  cursorHide: '\x1b[?25l',
  cursorShow: '\x1b[?25h',
  clearScreen: '\x1b[2J',
  home: '\x1b[H'
};

/**
 * Strips ANSI escape sequences from a string to measure display width.
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Pads or truncates a string to an exact visual width.
 */
function padTrunc(str, targetWidth) {
  const visible = stripAnsi(str);
  if (visible.length > targetWidth) {
    if (targetWidth <= 3) return visible.slice(0, targetWidth);
    return visible.slice(0, targetWidth - 1) + '…';
  }
  return str + ' '.repeat(targetWidth - visible.length);
}

/**
 * Formats an OTP code with spaces for readability.
 * e.g., "123456" -> "123 456", "12345678" -> "1234 5678"
 */
function formatOtp(code) {
  if (!code) return '------';
  const len = code.length;
  if (len === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (len === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  if (len === 7) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  return code;
}

/**
 * Builds a visual progress bar string.
 */
function renderProgressBar(remaining, period, barWidth = 8) {
  const ratio = Math.max(0, Math.min(1, remaining / period));
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;

  let color = ANSI.brightGreen;
  if (remaining <= 5) {
    color = ANSI.brightRed;
  } else if (remaining <= 10) {
    color = ANSI.brightYellow;
  }

  const fillChar = '█';
  const emptyChar = '░';
  return `${color}${fillChar.repeat(filled)}${ANSI.dim}${emptyChar.repeat(empty)}${ANSI.reset} ${color}${String(remaining).padStart(2)}s${ANSI.reset}`;
}

class AegisTui {
  constructor(vaultData, options = {}) {
    this.vaultData = vaultData;
    this.entries = vaultData.entries || [];
    this.fileName = options.fileName || 'vault.json';
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.searchQuery = '';
    this.isSearching = false;
    this.statusMessage = '';
    this.statusTimer = null;
    this.timerInterval = null;
    this.isRunning = false;

    this.onKeypress = this.onKeypress.bind(this);
    this.onResize = this.onResize.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }

  getFilteredEntries() {
    if (!this.searchQuery.trim()) {
      return this.entries;
    }
    const q = this.searchQuery.toLowerCase();
    return this.entries.filter(e => {
      const issuer = (e.issuer || '').toLowerCase();
      const name = (e.name || '').toLowerCase();
      const groups = (e.groups || []).join(' ').toLowerCase();
      const note = (e.note || '').toLowerCase();
      return issuer.includes(q) || name.includes(q) || groups.includes(q) || note.includes(q);
    });
  }

  setStatus(msg, durationMs = 3000) {
    this.statusMessage = msg;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    this.statusTimer = setTimeout(() => {
      this.statusMessage = '';
      this.render();
    }, durationMs);
  }

  start() {
    this.isRunning = true;

    // Switch to alternate screen and hide cursor
    process.stdout.write(ANSI.altScreenOn + ANSI.cursorHide + ANSI.clearScreen);

    // Setup input
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', this.onKeypress);
    process.stdout.on('resize', this.onResize);

    // Trap exits to guarantee cleanup
    process.on('SIGINT', this.cleanup);
    process.on('SIGTERM', this.cleanup);
    process.on('exit', this.cleanup);

    // Refresh every second for live countdown and code updates
    this.timerInterval = setInterval(() => {
      this.render();
    }, 1000);

    this.render();
  }

  cleanup() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch (_) {}
    }
    process.stdin.removeListener('keypress', this.onKeypress);
    process.stdout.removeListener('resize', this.onResize);

    // Restore terminal screen and cursor
    process.stdout.write(ANSI.cursorShow + ANSI.altScreenOff);
    process.exit(0);
  }

  onResize() {
    this.render();
  }

  async copyCurrentCode() {
    const filtered = this.getFilteredEntries();
    if (filtered.length === 0) return;

    const entry = filtered[this.selectedIndex];
    if (!entry) return;

    let code = '';
    try {
      if (entry.type === 'hotp') {
        code = generateHOTP(entry.secret, entry.counter, {
          digits: entry.digits,
          algo: entry.algo
        });
      } else {
        code = generateTOTP(entry.secret, {
          digits: entry.digits,
          period: entry.period,
          algo: entry.algo,
          isSteam: entry.type === 'steam'
        });
      }
      await copyToClipboard(code);
      const label = entry.issuer || entry.name || 'OTP';
      this.setStatus(`${ANSI.brightGreen}✔ Copied [${code}] for ${label} to clipboard!${ANSI.reset}`);
    } catch (err) {
      this.setStatus(`${ANSI.brightRed}✘ Failed to generate code: ${err.message}${ANSI.reset}`);
    }
    this.render();
  }

  onKeypress(str, key) {
    if (!key) {
      key = { name: str };
    }

    // Global quit on Ctrl+C
    if (key.ctrl && key.name === 'c') {
      this.cleanup();
      return;
    }

    // Searching mode key handling
    if (this.isSearching) {
      if (key.name === 'escape') {
        this.isSearching = false;
        this.render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        this.isSearching = false;
        this.render();
        return;
      }
      if (key.name === 'backspace') {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.render();
        return;
      }
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        this.searchQuery += str;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.render();
        return;
      }
      return;
    }

    // Normal mode key handling
    const filtered = this.getFilteredEntries();
    const count = filtered.length;

    switch (key.name) {
      case 'q':
        this.cleanup();
        break;

      case 'up':
      case 'k':
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this.render();
        }
        break;

      case 'down':
      case 'j':
        if (this.selectedIndex < count - 1) {
          this.selectedIndex++;
          this.render();
        }
        break;

      case 'pageup':
        this.selectedIndex = Math.max(0, this.selectedIndex - 10);
        this.render();
        break;

      case 'pagedown':
        this.selectedIndex = Math.min(Math.max(0, count - 1), this.selectedIndex + 10);
        this.render();
        break;

      case 'home':
        this.selectedIndex = 0;
        this.render();
        break;

      case 'end':
        this.selectedIndex = Math.max(0, count - 1);
        this.render();
        break;

      case 'return':
      case 'enter':
      case 'space':
      case 'c':
        this.copyCurrentCode();
        break;

      case 'escape':
        if (this.searchQuery) {
          this.searchQuery = '';
          this.selectedIndex = 0;
          this.scrollOffset = 0;
          this.setStatus(`${ANSI.dim}Search filter cleared${ANSI.reset}`);
          this.render();
        }
        break;

      default:
        if (str === '/') {
          this.isSearching = true;
          this.render();
        }
        break;
    }
  }

  render() {
    if (!this.isRunning) return;

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    const filtered = this.getFilteredEntries();
    const totalCount = this.entries.length;
    const filteredCount = filtered.length;

    // Clamp selectedIndex
    if (this.selectedIndex >= filteredCount) {
      this.selectedIndex = Math.max(0, filteredCount - 1);
    }
    if (this.selectedIndex < 0) {
      this.selectedIndex = 0;
    }

    // Available rows for the entry table:
    // 1 header + 1 subheader + 1 search bar + 1 divider + 1 table header + 1 divider + 1 divider + 1 status + 1 footer = 9 rows overhead
    const tableHeight = Math.max(3, rows - 9);

    // Adjust scroll offset
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + tableHeight) {
      this.scrollOffset = this.selectedIndex - tableHeight + 1;
    }

    const lines = [];

    // --- Header ---
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const encBadge = this.vaultData.isEncrypted
      ? `${ANSI.brightYellow}[Encrypted]${ANSI.reset}`
      : `${ANSI.green}[Plain]${ANSI.reset}`;

    const titleLeft = ` ${ANSI.bold}${ANSI.brightCyan}🛡️  AEGIS TUI${ANSI.reset} │ ${ANSI.white}${this.fileName}${ANSI.reset} ${encBadge}`;
    const titleRight = `${ANSI.dim}Total:${ANSI.reset} ${ANSI.bold}${totalCount}${ANSI.reset} │ ${ANSI.brightWhite}${timeStr}${ANSI.reset} `;
    const padHeader = Math.max(0, cols - stripAnsi(titleLeft).length - stripAnsi(titleRight).length);
    lines.push(titleLeft + ' '.repeat(padHeader) + titleRight);

    // --- Search / Filter bar ---
    let searchLine = '';
    if (this.isSearching) {
      searchLine = ` ${ANSI.bgCyan}${ANSI.black} SEARCH ${ANSI.reset} ${ANSI.bold}> ${this.searchQuery}${ANSI.brightYellow}█${ANSI.reset}  ${ANSI.dim}(Enter to confirm, Esc to cancel)${ANSI.reset}`;
    } else if (this.searchQuery) {
      searchLine = ` ${ANSI.yellow}Filter:${ANSI.reset} "${ANSI.bold}${this.searchQuery}${ANSI.reset}" ${ANSI.dim}(${filteredCount} matches, Esc to clear)${ANSI.reset}`;
    } else {
      searchLine = ` ${ANSI.dim}Filter: (Press ${ANSI.reset}/${ANSI.dim} to search accounts)${ANSI.reset}`;
    }
    lines.push(padTrunc(searchLine, cols));

    // --- Table Header ---
    // Column layout:
    // [Sel 2] [Issuer 20] [Account Name 22] [OTP Code 12] [Countdown 13] [Type 8]
    const wSel = 2;
    const wOtp = 12;
    const wCountdown = 14;
    const wType = 8;
    const remainingWidth = Math.max(20, cols - (wSel + wOtp + wCountdown + wType + 6));
    const wIssuer = Math.min(22, Math.max(12, Math.floor(remainingWidth * 0.45)));
    const wName = Math.max(10, remainingWidth - wIssuer);

    const th = [
      ' '.repeat(wSel),
      padTrunc(`${ANSI.bold}ISSUER${ANSI.reset}`, wIssuer),
      padTrunc(`${ANSI.bold}ACCOUNT / NAME${ANSI.reset}`, wName),
      padTrunc(`${ANSI.bold}TOKEN CODE${ANSI.reset}`, wOtp),
      padTrunc(`${ANSI.bold}REMAINING${ANSI.reset}`, wCountdown),
      padTrunc(`${ANSI.bold}TYPE${ANSI.reset}`, wType)
    ].join(' ');

    lines.push(ANSI.dim + '─'.repeat(cols) + ANSI.reset);
    lines.push(th);
    lines.push(ANSI.dim + '─'.repeat(cols) + ANSI.reset);

    // --- Entries List ---
    const visibleEntries = filtered.slice(this.scrollOffset, this.scrollOffset + tableHeight);
    const nowSec = Math.floor(Date.now() / 1000);

    if (filteredCount === 0) {
      const msg = this.entries.length === 0
        ? 'No entries found in this Aegis vault.'
        : `No accounts matching "${this.searchQuery}"`;
      lines.push(`  ${ANSI.yellow}${msg}${ANSI.reset}`);
      for (let i = 1; i < tableHeight; i++) {
        lines.push('');
      }
    } else {
      for (let i = 0; i < tableHeight; i++) {
        if (i < visibleEntries.length) {
          const entry = visibleEntries[i];
          const actualIndex = this.scrollOffset + i;
          const isSelected = actualIndex === this.selectedIndex;

          let otpCode = '------';
          let countdownStr = '';
          try {
            if (entry.type === 'hotp') {
              otpCode = generateHOTP(entry.secret, entry.counter, {
                digits: entry.digits,
                algo: entry.algo
              });
              countdownStr = `${ANSI.dim}cnt:${entry.counter}${ANSI.reset}`;
            } else {
              otpCode = generateTOTP(entry.secret, {
                digits: entry.digits,
                period: entry.period,
                algo: entry.algo,
                isSteam: entry.type === 'steam',
                timestamp: nowSec
              });
              const rem = getRemainingSeconds(entry.period, nowSec);
              countdownStr = renderProgressBar(rem, entry.period, 6);
            }
          } catch (e) {
            otpCode = 'ERROR!';
            countdownStr = `${ANSI.red}ERR${ANSI.reset}`;
          }

          const selMarker = isSelected ? `${ANSI.brightCyan}▸${ANSI.reset} ` : '  ';
          const favMarker = entry.favorite ? `${ANSI.brightYellow}★${ANSI.reset} ` : '';

          const issuerStr = favMarker + (entry.issuer || '(None)');
          const nameStr = entry.name || '(Unnamed)';
          const typeStr = (entry.type || 'TOTP').toUpperCase();

          const formattedCode = formatOtp(otpCode);

          let rowBg = '';
          let rowFg = '';
          if (isSelected) {
            rowBg = ANSI.bgSelected;
            rowFg = ANSI.brightWhite;
          }

          const colIssuer = padTrunc(`${isSelected ? ANSI.bold + ANSI.brightCyan : ANSI.cyan}${issuerStr}${ANSI.reset}`, wIssuer);
          const colName = padTrunc(`${isSelected ? ANSI.brightWhite : ANSI.dim}${nameStr}${ANSI.reset}`, wName);
          const colOtp = padTrunc(`${ANSI.bold}${isSelected ? ANSI.brightYellow : ANSI.yellow}${formattedCode}${ANSI.reset}`, wOtp);
          const colCountdown = padTrunc(countdownStr, wCountdown);
          const colType = padTrunc(`${ANSI.dim}${typeStr}${ANSI.reset}`, wType);

          const rowContent = `${selMarker}${colIssuer} ${colName} ${colOtp} ${colCountdown} ${colType}`;
          lines.push(rowBg + rowContent + ANSI.reset);
        } else {
          lines.push('');
        }
      }
    }

    // --- Divider ---
    lines.push(ANSI.dim + '─'.repeat(cols) + ANSI.reset);

    // --- Status line / Toast message ---
    let statusText = this.statusMessage;
    if (!statusText) {
      if (filteredCount > 0) {
        statusText = `${ANSI.dim}Selected: ${this.selectedIndex + 1}/${filteredCount}${ANSI.reset}`;
      } else {
        statusText = `${ANSI.dim}0 accounts${ANSI.reset}`;
      }
    }
    lines.push(` ${statusText}`);

    // --- Footer help bar ---
    const footer = [
      `${ANSI.bgDarkGray} ↑/↓/j/k ${ANSI.reset} Select`,
      `${ANSI.bgDarkGray} Enter/c ${ANSI.reset} Copy OTP`,
      `${ANSI.bgDarkGray} / ${ANSI.reset} Search`,
      `${ANSI.bgDarkGray} Esc ${ANSI.reset} Clear`,
      `${ANSI.bgDarkGray} q ${ANSI.reset} Quit`
    ].join('  ');
    lines.push(` ${footer}`);

    // Draw frame in single write
    const frame = lines.map(l => padTrunc(l, cols)).join('\n');
    process.stdout.write(ANSI.home + frame);
  }
}

module.exports = {
  AegisTui,
  ANSI,
  stripAnsi,
  formatOtp,
  padTrunc
};

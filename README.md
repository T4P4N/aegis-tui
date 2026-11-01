# Aegis TUI 🛡️

A lightweight, zero-dependency Terminal User Interface (TUI) for [Aegis Authenticator](https://github.com/beemdevelopment/aegis) vault exports.

It reads an exported Aegis JSON vault (both **unencrypted** and **password-encrypted**), displays your accounts, and calculates live **TOTP** codes with real-time countdown progress.

---

## Features

- **Direct Aegis JSON Support**: Works directly with exported Aegis vault JSON files.
- **Plaintext & Encrypted Vaults**: Decrypts password-protected Aegis vaults using standard `scrypt` + `AES-256-GCM` with interactive masked password prompt or `-p` flag.
- **Live TOTP Generation**: Fully compliant with RFC 6238 (TOTP) and RFC 4226 (HOTP), plus Steam Guard 5-character OTP. Supports SHA1, SHA256, and SHA512 algorithms.
- **Visual Countdown Progress**: Dynamic countdown timer with color cues (>10s green, 5–10s yellow, ≤5s red).
- **Fast Search & Filter**: Press `/` to search across issuers, account names, and groups in real-time.
- **One-Key Clipboard Copy**: Press `Enter` or `c` to copy the selected OTP code to your clipboard (supports X11 `xclip`, Wayland `wl-copy`, macOS `pbcopy`, and universal terminal OSC 52).
- **Zero External Dependencies**: Built with pure Node.js built-ins (`crypto`, `readline`, `child_process`, `fs`). No `node_modules` bloat, instant startup, and trivial to debug.
- **Clean Terminal Handling**: Uses alternate screen buffer mode so your terminal history is preserved cleanly on exit.

---

## Quick Start

### 1. Run Directly

```bash
# Clone or navigate to the repo
cd aegis-tui

# Run with an unencrypted vault:
node bin/aegis-tui.js samples/aegis_plain.json

# Run with an encrypted vault:
node bin/aegis-tui.js samples/aegis_encrypted.json
# (Will prompt for password; for the sample file, the password is 'test')
```

### 2. Global Link (Optional)

You can link it to run `aegis-tui` from anywhere:

```bash
npm link
aegis-tui /path/to/your/aegis-export.json
```

---

## ⌨️ Keyboard Controls

| Key | Action |
| :--- | :--- |
| `↑` / `k` | Move to previous entry |
| `↓` / `j` | Move to next entry |
| `PgUp` / `PgDn` | Scroll up / down 10 entries |
| `Home` / `End` | Jump to start / end |
| `Enter` / `c` / `Space` | Copy current OTP code to clipboard |
| `/` | Start real-time search / filter |
| `Esc` | Clear search / exit search mode |
| `q` / `Ctrl+C` | Quit |

---

## CLI Usage

```text
aegis-tui [options] [path/to/aegis_export.json]

Arguments:
  [vault.json]          Path to exported Aegis JSON vault

Options:
  -p, --password <pwd>  Password for encrypted vaults (or enter at prompt)
  -h, --help            Show help screen
  -v, --version         Show version
```

### Environment Variables

- `AEGIS_PASSWORD`: If set, will be used automatically when loading encrypted vaults without prompting.

---

## Testing

Run the test suite (uses Node.js native test runner):

```bash
npm test
```

Tests verify:
- RFC 4226 HOTP test vectors
- RFC 6238 TOTP test vectors (SHA1, SHA256, SHA512)
- Base32 encoding / decoding (RFC 4648)
- Aegis Scrypt + AES-256-GCM vault decryption
- Steam Guard 5-digit alphanumeric generation
- TUI formatting and search filtering logic

---

## Project Structure

```text
aegis-tui/
├── bin/
│   └── aegis-tui.js         # CLI entry point and password prompt
├── src/
│   ├── crypto.js            # Base32, RFC 6238/4226 OTP math, and AES-GCM decryption
│   ├── vault.js             # Aegis vault loading, detection, and schema normalization
│   ├── tui.js               # Terminal UI rendering, event loop, and keyboard handling
│   └── clipboard.js         # OS clipboard copy (xclip/wl-copy/pbcopy/OSC 52)
├── test/
│   ├── crypto.test.js       # Crypto & OTP verification against RFC vectors
│   ├── vault.test.js        # Vault loading and schema parsing tests
│   └── tui.test.js          # UI formatting and filter logic tests
├── samples/
│   ├── aegis_plain.json     # Sample unencrypted vault from Aegis tests
│   └── aegis_encrypted.json # Sample encrypted vault (password: "test")
└── package.json
```

- Note: This is project is made with agy cli, i was not able to find good TOTP app, which supported my aegis json export, hence i decided to build it for myself. Drop a start if you find it is useful.


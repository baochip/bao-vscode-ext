# Baochip Tools CLI

**Baochip Tools CLI** is a command-line tool for serial communication and diagnostics for Baochip-based embedded systems. It is bundled with the [bao-vscode-ext](https://github.com/baochip/bao-vscode-ext) VS Code extension but can also be used standalone.

## Requirements

Python 3.9+, then install dependencies:

```sh
pip install -r requirements.txt
```

## Commands

### `ports`
List all available serial ports on your system.

```sh
python bao.py ports
```

### `monitor`
Open an interactive serial monitor.

**Options:**
- `-p, --port` (required): Serial port (e.g., `COM5`, `/dev/ttyUSB0`)
- `-b, --baud`: Baud rate (default: 1000000)
- `--raw` / `--no-raw`: Send keystrokes immediately (raw mode) / send full lines (line mode)
- `--crlf` / `--no-crlf`: Use CRLF / LF as the TX line ending in line mode
- `--echo` / `--no-echo`: Locally echo typed input / rely on the device's echo
- `--save <file>`: Append output to a file

Defaults (PuTTY-style): `--raw`, `--no-echo`, `--crlf`.

```sh
python bao.py monitor -p COM8
python bao.py monitor -p /dev/ttyUSB0 --save log.txt
python bao.py monitor -p COM8 --no-raw --echo   # line mode with local echo
```

### `boot`
Send the `boot` command to the bootloader serial port to start run mode.

**Options:**
- `-p, --port` (required): Bootloader serial port
- `-b, --baud`: Baud rate (default: 1000000)

```sh
python bao.py boot -p COM7
```

### `app`
App utilities for out-of-tree builds.

#### `app update-rev`
Update the `xous-core` git `rev` in a `Cargo.toml` (used by out-of-tree kernel sync so the app and kernel come from the same commit).

**Options:**
- `--file`: path to the `Cargo.toml` to edit (default: `Cargo.toml`)
- `--rev` (required): new `xous-core` git commit hash

```sh
python bao.py app update-rev --file Cargo.toml --rev <commit-hash>
```

## Global Options

- `-v, --verbose`: Enable verbose output (debug logging and tracebacks).

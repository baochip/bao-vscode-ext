# Baochip Tools CLI

**Baochip Tools CLI** is a command-line tool for serial communication and diagnostics for Baochip-based embedded systems. It is bundled with the [bao-vscode-ext](https://github.com/baochip/bao-vscode-ext) VS Code extension but can also be used standalone.

## Requirements

Python 3.7+, then install dependencies:

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
- `--raw`: Send keystrokes immediately (raw mode)
- `--crlf`: Use CRLF as TX line ending (default LF)
- `--no-echo`: Do not locally echo typed input
- `--save <file>`: Append output to a file

Defaults (PuTTY-style): `--raw`, `--no-echo`, `--crlf` are all enabled.

```sh
python bao.py monitor -p COM8
python bao.py monitor -p /dev/ttyUSB0 --save log.txt
```

### `boot`
Send the `boot` command to the bootloader serial port to start run mode.

**Options:**
- `-p, --port` (required): Bootloader serial port
- `-b, --baud`: Baud rate (default: 1000000)

```sh
python bao.py boot -p COM7
```

### `doctor`
Check your Python environment and serial port setup for common issues.

```sh
python bao.py doctor
```

## Global Options

- `-v, --verbose`: Enable verbose output (debug logging and tracebacks).

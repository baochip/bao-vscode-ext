# Baochip VSCode Extension

This extension adds a Baochip sidebar with the following actions:
- **Set monitor port** (QuickPick list from `bao.py ports`)
- **Set flash port** (QuickPick list from `bao.py ports`)
- **Monitor** (opens an in-editor webview showing serial output)

## Requirements
- Python 3
- [`bao-devkit`](https://github.com/baochip/bao-devkit) with `bao.py` working:
  - `python bao.py ports`
  - `python bao.py monitor -p <PORT>`

## Settings
- `baochip.pythonCommand` (default `python`)
- `baochip.baoPath` (path to `bao.py`)
- `baochip.monitorPort` (leave empty to be prompted)
- `baochip.defaultBaud` (default 115200)
- `baochip.flashPort` (leave empty to be prompted)

## Dev

```
npm install
npm run compile
```

Press F5 to launch Extension Development Host
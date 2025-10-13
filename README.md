# Baochip VSCode Extension

This extension adds a Baochip sidebar with two actions so far:
- **Set monitor port** (QuickPick list from `bao.py ports`)
- **Monitor** (opens an in-editor webview showing serial output)

## Requirements
- Python 3
- [`bao-devkit`](https://github.com/baochip/bao-devkit) with `bao.py` working:
  - `python bao.py ports`
  - `python bao.py monitor -p <PORT>`

## Settings
- `baochip.pythonCommand` (default `python`)
- `baochip.baoPath` (path to `bao.py`)
- `baochip.defaultPort` (leave empty to be prompted)
- `baochip.defaultBaud` (default 115200)

## Dev

```
npm install
npm run compile
```

Press F5 to launch Extension Development Host



bao bun icon by NAS from <a href="https://thenounproject.com/browse/icons/term/bao-bun/" target="_blank" title="bao bun Icons">Noun Project</a> (CC BY 3.0)
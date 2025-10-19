# Baochip VSCode Extension

This extension adds a Baochip sidebar with a welcome screen and the following commands:
- **Set monitor port** (QuickPick list from `bao.py ports`)
- **Set flash location**
- **Select flash method** (Quickpick list)
- **Select build target** (Quickpick list from `bao.py targets`)
- **Monitor** (opens an in-editor webview showing serial output)

## Requirements
- Python 3
- [`tools-bao`](https://github.com/betrusted-io/xous-core/tools-bao) with `bao.py`

## Dev

```
npm install
npm run compile
```
Then, press F5 to launch Extension Development Host
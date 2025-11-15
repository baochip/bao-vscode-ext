## [0.9.1] — 2025-11-15
### Changed
- Updated README with improved documentation for the Marketplace.

## [0.9.0] — 2025-11-15
### Added
- Initial public preview release of the Baochip VS Code extension.
- Welcome page with quick setup actions and documentation links.
- Application workflow:
  - Select app(s)
  - Create new app via tools-bao
- Build workflow:
  - Select build target
  - Support for multiple apps or target-only builds
  - Full clean
- **All-in-one "Build • Flash • Monitor" command** for a complete development loop in one step.
- Flash workflow:
  - UF2 flashing via tools-bao
  - Drive location auto-detection
- Serial Monitor:
  - Raw mode keystroke passthrough
  - Line mode with CRLF normalization
  - Auto port re-enumeration (Run Mode ↔ Bootloader Mode)
  - Graceful disconnect and stop handling
- Activity Bar integration:
  - Build, flash, and monitor shortcuts
  - Documentation view
- Workspace settings for:
  - Run Mode / Bootloader Mode serial ports  
  - Default monitor port  
  - Baud rate, CRLF, raw mode, and local echo  
  - Build targets, multiple apps, build working directory  
  - UF2 flash location  
  - xous-core repository path  
- Environment validation:
  - Python command detection
  - Tools-bao version check
  - UV environment setup/reset command
- Localization:
  - German (`de`)
  - Japanese (`ja`)
  - Simplified Chinese (`zh-cn`)
  - Traditional Chinese (`zh-tw`)

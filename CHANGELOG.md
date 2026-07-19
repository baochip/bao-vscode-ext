## [1.1.0] - 2026-07-11

### Added
- **Baochip: Collect Diagnostics** - one command gathers versions, settings, ports, and
  toolchain checks into a report, with copy-to-clipboard and GitHub issue reporting;
  nothing is sent automatically
- GitHub bug-report form with diagnostics instructions; hardware and Xous OS questions
  are routed to the right places
- **Baochip: Re-run Extension Setup** reinstalls the self-contained Python tooling
- Keybindings: Ctrl+Alt+F flashes, Ctrl+Alt+Shift+B runs Build • Flash • Monitor
- In-tree **baosec** target support: select the baosec target to build and flash a
  baosec app from your xous-core checkout, including its swap image (swap.uf2)

### Improved
- Live serial port picker: refreshes automatically as you plug in or switch board modes,
  with PROG/RESET instructions on screen; a missing saved port offers "Pick a different
  port" instead of failing
- The monitor runs in your regular shell again: Ctrl+C returns to your prompt at the
  project root, exits are always clean (no "terminated with exit code" notifications),
  and garbled device output can no longer corrupt the terminal
- Sidebar grouped into Setup / Project / Build & Run, with Welcome and Settings title
  icons and a get-started view when no folder is open
- The status bar row and Welcome auto-open appear only in Baochip-related workspaces
- Error notifications offer "Show Output" instead of opening the Output panel themselves
- Welcome page shows again for returning users; links and keyboard focus improved

### Fixed
- Builds failing with "aborted" while fetching the latest xous-core revision when certain
  other extensions are installed
- A monitor crash on Ctrl+C on Windows
- Many small fixes and hardening, now backed by a new automated test suite (unit,
  integration)

---

## [1.0.0] - 2026-06-04

### Out-of-Tree Builds
Build standalone Baochip apps without a local xous-core checkout.
- Auto-detects build mode from the open workspace
- Kernel files (loader.uf2, xous.uf2) downloaded from CI or sourced manually
- New app scaffolding from a starter template with local workspace patches
- xous-app-uf2 integration for UF2 conversion

### Reduced Python Dependency
Several operations that previously required bao.py are now native:
- Build artifact detection is native TypeScript
- App creation uses the bundled template directly
- tools-bao is bundled with the extension

### UX Improvements
- Auto-detect xous-core path when it is open in the workspace
- Auto-detect mounted BAOCHIP drive on macOS, Linux, and Windows
- Build/Flash/Monitor port wait is now cancellable
- New Set Monitor Baud command
- Status bar shows `dabao` as default target when none is configured
- Helpful error when trying to configure settings without a workspace open

### Settings
- Settings reorganized into In-tree Builds and Out-of-tree Builds sections
- Build mode (auto / xous-core / out-of-tree) is now a configurable setting

### Bug Fixes
- Fixed output channel leak on repeated builds/flashes
- Fixed monitor terminal not cleaning up when closed manually
- Fixed double error toast on subprocess failure
- Fixed shell path quoting for Linux compatibility

---

## [0.9.5] - 2025-12-13
### Changed
- Made the Welcome page setting user-scoped, migrating any existing workspace values and cleaning them from workspace configs.

## [0.9.4] - 2025-11-25
### Changed
- Less aggressive about installing requirements on extension launch
- pre-commit ensures proper formatting in project
- updated required VS Code version to 106.1

## [0.9.3] — 2025-11-15
### Changed
- Updated README.

## [0.9.2] — 2025-11-15
### Changed
- Updated README.

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

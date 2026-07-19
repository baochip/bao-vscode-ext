# Baochip VS Code Extension

A VS Code extension for developing applications for Baochip microcontrollers.  
This extension integrates building, flashing, and serial monitoring directly into the editor, providing a streamlined development workflow.

---

<img src="media/baochip_ext.png" width="800" alt="Baochip extension UI">

---

## Two ways to build

The extension supports two workflows and auto-detects which one you are in from the open workspace
(you can also set it explicitly in settings).

### Out-of-tree (recommended for most apps)

Build a standalone Baochip app in any folder - you do not need a local copy of `xous-core`. The
extension can create a starter project for you (set to a matching version of `xous-core`), or you can
open an existing project. It downloads the kernel files needed to build (or you can use your own). It
is the fastest way to get started.

### In-tree

Develop inside a local `xous-core` checkout. Your app lives alongside the OS under `apps-<target>/`,
and you build the whole system (kernel, services, and app) using the tree's own `cargo xtask`. Choose
this when you are modifying `xous-core` itself or building targets such as `baosec`.

---

## Quickstart

### Requirements

**Rust** (via [rustup](https://rustup.rs)) is the only thing you install yourself. The first time you
build, the extension asks before installing anything else it needs (the RISC-V target, Xous toolchain,
and related tools). Its Python tooling goes in VS Code's own storage and is removed when you uninstall
the extension (see Storage and disk space below).

### Out-of-tree (recommended)

1. Open your project folder in VS Code - new or existing, no `xous-core` needed.
2. For a new app, run **Baochip: New App** to create one from the starter template.
3. **Build**, **Flash**, and **Monitor** - kernel images are downloaded automatically.

### In-tree

1. Clone and open `xous-core`, or open your existing checkout:
   ```sh
   git clone https://github.com/betrusted-io/xous-core
   ```
2. Run **Baochip: New App** to add an app under `apps-<target>/`, or **Baochip: Select App** to use an existing one.
3. **Build**, **Flash**, and **Monitor**.

Prompts for paths, serial ports, and flash locations appear during normal use. You can also configure
everything from the command palette, the Baochip sidebar, or VS Code Settings.

---

## Features

- **Welcome page** - quick setup actions, app creation and selection, and documentation links.
- **App workflow** - create and select apps. Out-of-tree apps live in your project folder; in-tree
  apps live under `apps-<target>/`.
- **Build** - pick a build target (e.g. `dabao`, `baosec`), with full clean support.
- **Flash** - copy UF2 firmware to your Baochip device, with drive auto-detection and verification.
- **Serial monitor** - raw or line mode (with CRLF normalization), and Run Mode <-> Bootloader Mode
  port handling.
- **Build / Flash / Monitor** - one command builds, flashes, boots the board, and opens the monitor,
  for a fast edit-and-run loop.
- **Sidebar** - build, flash, and monitor controls plus app commands and documentation links.
- **Localization** - German (de), Japanese (ja), Simplified Chinese (zh-cn), Traditional Chinese
  (zh-tw).

---

## Storage and disk space

Anything the extension installs automatically - uv, and a Python runtime if none is found - goes into
VS Code's own storage, never into your project or onto your system PATH. It is fully self-contained
and removed when you uninstall the extension.

`Baochip: Reset UV Setup` clears the saved setup and can delete the cached virtual environment (rebuilt
on the next command); `Baochip: Re-run Extension Setup` deletes the private uv, Python, and virtual
environment and reinstalls them from scratch.

Approximate space used under VS Code global storage:

- uv (installed automatically if not already present): ~35 MB
- Python runtime (downloaded only if no system Python is found): ~150 MB
- Python virtual environment and dependencies (pyserial, etc.): ~30 MB

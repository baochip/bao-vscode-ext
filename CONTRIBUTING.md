# Contributing to bao-vscode-ext

Thanks for helping improve the Baochip VS Code extension! 💜

---

## Quick Start

**Prereqs**
- **Node.js** 24+ and npm  
- **VS Code** (latest stable)  

**Clone and install**

    git clone https://github.com/baochip/bao-vscode-ext.git
    cd bao-vscode-ext
    npm install

**Dev tooling**
- Install git hooks: `pre-commit install`
- Run local checks as needed: `pre-commit run`

**Run the extension**
1. Open the repo folder in VS Code.  
2. `npm run compile`
2. Press **F5** (or Run → **Start Debugging**) to launch an **Extension Development Host**.  
3. Use the Command Palette to try Baochip commands and verify changes.

> Note: This extension expects an [**`xous-core`**](https://github.com/betrusted-io/xous-core) workspace to be open and/or configured in order to do any actions.  

---

## Development Workflow

**Branch / PR target**
- Make a fork of this repo, then create a feature branch with a clear name.
- Keep PRs small and scoped.
- Open PRs against the default branch (**main**).

---

## Code Style

- Language: **TypeScript**  
- Formatting:  
  - Format and lint with Biome (`npm run format`, `npm run lint`).  
  - Keep imports tidy and minimal.  
  - Prefer consistent naming and clear function boundaries.
  - Make helper functions for clarity of code flow.
  - Keep consistent terminology with existing naming.
  - Keep UI copy concise and action-oriented (e.g., “Waiting for run mode serial port…”).

---

## Testing

**Automated tests**

    npm test                  # unit tests (Node + tsx)
    npm run test:integration  # runs the extension in a VS Code instance
    npm run test:python       # Python tooling tests (pytest via uv)

Unit tests live in `src/test/unit/`, integration tests in `src/test/integration/`, and the Python tooling tests in `resources/tools-bao/tests/`. All run in CI on every push/PR to `main`.

**Manual testing** — please also:
- Manually verify the command(s) you changed.  
- Exercise both **bootloader mode** and **run mode** flows if relevant.  
- Confirm that expected settings or lack thereof are handled gracefully.

---

## Submitting a PR

**Required Checklist**
- [ ] Code builds and runs in the Extension Development Host  
- [ ] `npm test` passes (unit)  
- [ ] `npm run test:integration` passes  
- [ ] You verified the flows you touched (manual checks)  
- [ ] PR description explains **what changed** and **why**  
- [ ] Screenshots/Videos for UI changes (if applicable)

**Review process**
- A maintainer will review for scope, clarity, and UX consistency.  
- You may be asked for follow-ups.

---

## Reporting Issues & Feature Requests

- Use GitHub Issues with a clear repro (logs, steps, environment).  
  - Please provide screenshots and/or videos of the issue for ease of troubleshooting.
- For features, describe the user story in detail and the command(s)/UI affected.

---

## License

By contributing, you agree your contributions are licensed under this repository’s license.

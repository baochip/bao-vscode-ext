import * as fs from 'fs';
import * as path from 'path';

export async function listBaoApps(xousRoot: string): Promise<string[]> {
  const appsDir = path.join(xousRoot, 'apps-dabao');
  if (!fs.existsSync(appsDir) || !fs.statSync(appsDir).isDirectory()) return [];
  const entries = fs.readdirSync(appsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(appsDir, name, 'Cargo.toml')))
    .sort((a, b) => a.localeCompare(b));
}

export function isValidAppName(name: string): boolean {
  // simple, cargo-friendly: letters, numbers, underscores, hyphens; must start with a letter
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function scaffoldBaoApp(xousRoot: string, appName: string) {
  const appsDir = path.join(xousRoot, 'apps-dabao');
  const appDir = path.join(appsDir, appName);
  if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });
  if (fs.existsSync(appDir)) throw new Error(`App folder already exists: ${appDir}`);

  fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });

  // Minimal Cargo.toml (adjust later to match any Xous-specific expectations)
  const cargoToml = `[package]
name = "${appName}"
version = "0.1.0"
edition = "2021"

[dependencies]
`;

  const mainRs = `#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn main() -> ! {
    // TODO: call into Xous syscalls once linked via workspace
    loop {}
}
`;

  fs.writeFileSync(path.join(appDir, 'Cargo.toml'), cargoToml, { encoding: 'utf8' });
  fs.writeFileSync(path.join(appDir, 'src', 'main.rs'), mainRs, { encoding: 'utf8' });

  return appDir;
}

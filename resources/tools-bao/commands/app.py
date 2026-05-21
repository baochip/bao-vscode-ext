import argparse, re, shutil
from pathlib import Path
from typing import List, Set
from utils.toml_utils import navigate, read_toml, write_toml

VALID_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]*$")

TARGET_CONFIG = {
    "dabao":  {"apps_dir": "apps-dabao",  "template_app": "helloworld"},
    "baosec": {"apps_dir": "apps-baosec", "template_app": "vault2"},
}


def _target_config(target: str) -> dict:
    cfg = TARGET_CONFIG.get(target)
    if cfg is None:
        raise ValueError(f"unknown target: {target!r}. Known targets: {', '.join(TARGET_CONFIG)}")
    return cfg


def _workspace_members(root: Path) -> List[str]:
    doc = read_toml(root / "Cargo.toml")
    try:
        return [str(x) for x in navigate(doc, ["workspace", "members"])]
    except KeyError:
        return []


def _workspace_package_names(root: Path) -> Set[str]:
    names: Set[str] = set()
    for rel in _workspace_members(root):
        pkg_cargo = root / rel / "Cargo.toml"
        if not pkg_cargo.exists():
            continue
        try:
            pkg_doc = read_toml(pkg_cargo)
            names.add(str(navigate(pkg_doc, ["package", "name"])))
        except Exception:
            pass
    return names


def _add_member_if_missing(root: Path, rel: str) -> bool:
    cargo = root / "Cargo.toml"
    doc = read_toml(cargo)
    ws = doc.setdefault("workspace", {})
    arr = ws.setdefault("members", [])
    if any(str(x) == rel for x in arr):
        return False
    arr.append(rel)  # tomlkit preserves array style & trailing commas
    write_toml(cargo, doc)
    return True


def _copy_template_cargo(template: Path, dest: Path, new_name: str):
    doc = read_toml(template)
    if "package" not in doc:
        raise RuntimeError("Template Cargo.toml missing [package]")
    doc["package"]["name"] = new_name
    write_toml(dest, doc)


def _copy_template_src(root: Path, new_dir: Path, apps_dir: str, template_app: str):
    from utils.toml_utils import write_file
    src_template = root / apps_dir / template_app / "src"
    dest_src = new_dir / "src"
    if src_template.exists():
        shutil.copytree(src_template, dest_src)
    else:
        write_file(dest_src / "main.rs", """#![no_std]
#![no_main]
use core::panic::PanicInfo;
#[panic_handler] fn panic(_info: &PanicInfo) -> ! { loop {} }
#[no_mangle] pub extern "C" fn main() -> ! { loop {} }
""")


def cmd_app_create(args: argparse.Namespace) -> int:
    root = Path(args.xous_root).resolve()
    name = args.name.strip().lower()

    try:
        cfg = _target_config(args.target)
    except ValueError as e:
        print(f"error: {e}")
        return 2

    apps_dir_name = cfg["apps_dir"]
    template_app = cfg["template_app"]

    if not VALID_NAME_RE.match(name):
        print("error: invalid app name. Use lowercase [a-z][a-z0-9_-]*")
        return 2

    apps_dir = root / apps_dir_name
    template_cargo = apps_dir / template_app / "Cargo.toml"
    if not template_cargo.exists():
        print(f"error: template not found at {template_cargo}")
        return 2

    existing_pkg_names = _workspace_package_names(root)
    if name in existing_pkg_names:
        print(f'error: package name "{name}" already exists in workspace')
        return 2

    new_dir = apps_dir / name
    if new_dir.exists():
        print(f"error: app directory already exists: {new_dir}")
        return 2

    new_dir.mkdir(parents=True)
    _copy_template_cargo(template_cargo, new_dir / "Cargo.toml", name)
    _copy_template_src(root, new_dir, apps_dir_name, template_app)

    rel_member = f"{apps_dir_name}/{name}"
    _add_member_if_missing(root, rel_member)

    print(f"created: {rel_member}")
    return 0


def register(sub: argparse._SubParsersAction):
    ap = sub.add_parser("app", help="Bao app utilities")
    sp = ap.add_subparsers(dest="app_cmd", required=True)

    ap_create = sp.add_parser("create", help="Create a new Bao app")
    ap_create.add_argument("--xous-root", default=".", help="path to xous-core root")
    ap_create.add_argument("--target", required=True, choices=list(TARGET_CONFIG), help="target board (e.g. dabao, baosec)")
    ap_create.add_argument("--name", required=True, help="new app name (crate name)")
    ap_create.set_defaults(func=cmd_app_create)

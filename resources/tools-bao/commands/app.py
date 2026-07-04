import argparse
import logging
from pathlib import Path
from utils.toml_utils import navigate, read_toml, write_toml

XOUS_CORE_GIT_URL = "betrusted-io/xous-core"


def cmd_app_update_rev(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.exists():
        logging.error(f"file not found: {path}")
        return 2

    doc = read_toml(path)
    updated = False

    # Search [dependencies] and [workspace.dependencies]
    for section_keys in [["dependencies"], ["workspace", "dependencies"]]:
        try:
            deps = navigate(doc, section_keys)
        except (KeyError, TypeError):
            continue
        for dep_val in deps.values():
            if not isinstance(dep_val, dict):
                continue
            if XOUS_CORE_GIT_URL in str(dep_val.get("git", "")):
                dep_val["rev"] = args.rev
                updated = True

    if not updated:
        logging.error(f"no dependency with git URL containing '{XOUS_CORE_GIT_URL}' found in {path}")
        return 2

    write_toml(path, doc)
    print(f"updated xous-core rev to {args.rev}")
    return 0


def register(sub: argparse._SubParsersAction) -> None:
    ap = sub.add_parser("app", help="Bao app utilities")
    sp = ap.add_subparsers(dest="app_cmd", required=True)

    ap_rev = sp.add_parser("update-rev", help="Update the xous-core git rev in a Cargo.toml")
    ap_rev.add_argument("--file", default="Cargo.toml", help="path to Cargo.toml (default: Cargo.toml)")
    ap_rev.add_argument("--rev", required=True, help="new xous-core git commit hash")
    ap_rev.set_defaults(func=cmd_app_update_rev)

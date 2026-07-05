import argparse
import logging
from pathlib import Path
from utils.toml_utils import navigate, read_toml, write_toml

XOUS_CORE_REPO_PATH = "betrusted-io/xous-core"

# Sections that can carry git dependencies, at top level and under [target."cfg(...)"].
DEP_SECTIONS = ("dependencies", "dev-dependencies", "build-dependencies")


def _is_xous_core_url(url: str) -> bool:
    """Exact repo match: .../betrusted-io/xous-core, optionally with .git or a trailing
    slash - so sibling repos like xous-core-utils never match."""
    tail = url.strip().rstrip("/")
    if tail.endswith(".git"):
        tail = tail[: -len(".git")]
    return tail.endswith("/" + XOUS_CORE_REPO_PATH)


def _dependency_tables(doc):
    """Every table that can hold dependency entries: the top-level and per-target
    dependency sections, plus [workspace.dependencies]."""
    tables = []
    for name in DEP_SECTIONS:
        try:
            tables.append(navigate(doc, [name]))
        except (KeyError, TypeError):
            pass
    try:
        tables.append(navigate(doc, ["workspace", "dependencies"]))
    except (KeyError, TypeError):
        pass
    try:
        target = navigate(doc, ["target"])
    except (KeyError, TypeError):
        target = None
    if isinstance(target, dict):
        for cfg_table in target.values():
            if not isinstance(cfg_table, dict):
                continue
            for name in DEP_SECTIONS:
                dep_table = cfg_table.get(name)
                if isinstance(dep_table, dict):
                    tables.append(dep_table)
    return tables


def cmd_app_update_rev(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.exists():
        logging.error(f"file not found: {path}")
        return 2

    doc = read_toml(path)
    updated = False

    for deps in _dependency_tables(doc):
        for dep_val in deps.values():
            if not isinstance(dep_val, dict):
                continue
            if _is_xous_core_url(str(dep_val.get("git", ""))):
                # cargo allows only one of branch/tag/rev on a git dep - drop any existing
                # pin so setting rev cannot produce a manifest cargo rejects
                dep_val.pop("branch", None)
                dep_val.pop("tag", None)
                dep_val["rev"] = args.rev
                updated = True

    if not updated:
        logging.error(f"no dependency with a git URL for '{XOUS_CORE_REPO_PATH}' found in {path}")
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

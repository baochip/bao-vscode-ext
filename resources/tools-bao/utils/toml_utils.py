import os
from pathlib import Path
from tomlkit import parse as toml_parse, dumps as toml_dumps


def read_file(path: Path) -> str:
    # utf-8-sig: accepts (and strips) a BOM some Windows editors prepend; identical to
    # plain utf-8 for BOM-less files
    with path.open("r", encoding="utf-8-sig") as f:
        return f.read()


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic: write a sibling temp file, then replace - a crash mid-write can never leave a
    # truncated Cargo.toml at the destination.
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    os.replace(tmp, path)


def navigate(node, keys: list[str]):
    """Walk a tomlkit document by a list of key segments."""
    for key in keys:
        node = node[key]
    return node


def read_toml(path: Path):
    return toml_parse(read_file(path))


def write_toml(path: Path, doc) -> None:
    write_file(path, toml_dumps(doc))

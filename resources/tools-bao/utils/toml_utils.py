import os
import tempfile
import time
from pathlib import Path
from tomlkit import parse as toml_parse, dumps as toml_dumps


def read_file(path: Path) -> str:
    # utf-8-sig: accepts (and strips) a BOM some Windows editors prepend; identical to
    # plain utf-8 for BOM-less files
    with path.open("r", encoding="utf-8-sig") as f:
        return f.read()


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write via a UNIQUE temp file (not a fixed <name>.tmp) in the same directory, then
    # replace - so two concurrent writers never clobber each other's temp or truncate the dest.
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        # os.replace can transiently fail on Windows (PermissionError) when the destination is
        # briefly locked by a concurrent replace or a scanner; retry a few times.
        for attempt in range(20):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.02)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def navigate(node, keys: list[str]):
    """Walk a tomlkit document by a list of key segments."""
    for key in keys:
        node = node[key]
    return node


def read_toml(path: Path):
    return toml_parse(read_file(path))


def write_toml(path: Path, doc) -> None:
    write_file(path, toml_dumps(doc))

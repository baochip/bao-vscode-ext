from pathlib import Path
from tomlkit import parse as toml_parse, dumps as toml_dumps


def read_file(path: Path) -> str:
    with path.open("r", encoding="utf-8") as f:
        return f.read()


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def navigate(node, keys: list[str]):
    """Walk a tomlkit document by a list of key segments."""
    for key in keys:
        node = node[key]
    return node


def read_toml(path: Path):
    return toml_parse(read_file(path))


def write_toml(path: Path, doc) -> None:
    write_file(path, toml_dumps(doc))

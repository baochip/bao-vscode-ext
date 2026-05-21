from pathlib import Path
from utils.toml_utils import navigate, read_toml, write_toml


def cmd_toml_get(args) -> None:
    doc = read_toml(Path(args.file))
    keys = args.key.split(".")
    try:
        print(navigate(doc, keys))
    except KeyError as e:
        raise SystemExit(f"error: key not found: {e}")


def cmd_toml_set(args) -> None:
    path = Path(args.file)
    doc = read_toml(path)
    keys = args.key.split(".")
    try:
        parent = navigate(doc, keys[:-1]) if len(keys) > 1 else doc
        parent[keys[-1]] = args.value
    except KeyError as e:
        raise SystemExit(f"error: key not found: {e}")
    write_toml(path, doc)


def register(sub) -> None:
    t = sub.add_parser("toml", help="Read or write TOML fields")
    sp = t.add_subparsers(dest="toml_cmd", required=True)

    g = sp.add_parser("get", help="Print a TOML field value by dotted key")
    g.add_argument("--file", required=True, help="Path to TOML file")
    g.add_argument("--key", required=True, help="Dotted key (e.g. dependencies.xous.rev)")
    g.set_defaults(func=cmd_toml_get)

    s = sp.add_parser("set", help="Update a TOML field value by dotted key")
    s.add_argument("--file", required=True, help="Path to TOML file")
    s.add_argument("--key", required=True, help="Dotted key (e.g. dependencies.xous.rev)")
    s.add_argument("--value", required=True, help="New value (written as a string)")
    s.set_defaults(func=cmd_toml_set)

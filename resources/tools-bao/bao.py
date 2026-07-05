import argparse
import sys
import logging
import traceback

from commands import app
from commands import boot
from commands import monitor
from commands import ports

def main():
    ap = argparse.ArgumentParser(
        prog="bao.py",
        description="Baochip CLI - host-side utilities for Baochip development."
    )
    ap.add_argument("-v", "--verbose", action="store_true", help="Enable verbose output (debug logging and tracebacks)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    app.register(sub)
    boot.register(sub)
    monitor.register(sub)
    ports.register(sub)

    args = ap.parse_args()

    log_level = logging.DEBUG if getattr(args, "verbose", False) else logging.WARNING
    logging.basicConfig(level=log_level, format="[bao] %(levelname)s: %(message)s")

    try:
        code = args.func(args)
    except KeyboardInterrupt:
        print("\n[bao] aborted by user.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[bao] error: {e}", file=sys.stderr)
        if getattr(args, "verbose", False):
            traceback.print_exc()
        sys.exit(1)

    # Commands return an int exit code (or None for success); propagate it to the process.
    sys.exit(code or 0)

if __name__ == "__main__":
    main()

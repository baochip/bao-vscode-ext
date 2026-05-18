import argparse
import sys
import logging
import traceback

from commands import ports
from commands import monitor
from commands import doctor
from commands import boot

def main():
    ap = argparse.ArgumentParser(
        prog="bao.py",
        description="Baochip CLI — host-side utilities for Baochip development."
    )
    ap.add_argument("-v", "--verbose", action="store_true", help="Enable verbose output (debug logging and tracebacks)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ports.register(sub)
    monitor.register(sub)
    doctor.register(sub)
    boot.register(sub)

    args = ap.parse_args()

    log_level = logging.DEBUG if getattr(args, "verbose", False) else logging.WARNING
    logging.basicConfig(level=log_level, format="[bao] %(levelname)s: %(message)s")

    try:
        args.func(args)
    except KeyboardInterrupt:
        print("\n[bao] aborted by user.")
        sys.exit(1)
    except Exception as e:
        if getattr(args, "verbose", False):
            print(f"[bao] error: {e}", file=sys.stderr)
            traceback.print_exc()
        else:
            print(f"[bao] error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

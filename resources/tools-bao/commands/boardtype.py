import argparse
import re
import time
import logging
from serial.serialutil import SerialException
from utils.serial_utils import DEFAULT_BAUD, open_serial

# A USB CDC port that just enumerated can drop bytes written immediately after the open,
# losing the command with no error anywhere.
DEFAULT_SETTLE_S = 0.25

# How long to wait for the bootloader to answer before giving up.
DEFAULT_TIMEOUT_S = 2.0

# The bootloader prints the Rust enum name, e.g. "Board type is set to: Dabao".
_REPLY_RE = re.compile(r"Board type is set to:\s*(\w+)", re.IGNORECASE)


def parse_board_type(text: str) -> str | None:
    """Pull the board type out of the bootloader's reply, lowercased. None if it is not in there."""
    m = _REPLY_RE.search(text)
    return m.group(1).lower() if m else None


def cmd_boardtype(args: argparse.Namespace) -> int:
    port = args.port
    baud = args.baud
    settle = max(0.0, getattr(args, "settle", DEFAULT_SETTLE_S))
    deadline_s = max(0.1, getattr(args, "timeout", DEFAULT_TIMEOUT_S))
    try:
        # open_serial releases DTR/RTS; asserted control lines can reset the device.
        ser = open_serial(port, baud, timeout=0.2)
    except SerialException as e:
        logging.error(str(e))
        return 2
    except Exception as e:
        logging.error(f"cannot open {port}: {e}")
        return 2

    try:
        with ser:
            if settle:
                time.sleep(settle)

            # Terminate any partial line the device already buffered, so the command below
            # is parsed as "boardtype" and not as the tail of something else.
            ser.write(b"\r\n")
            ser.flush()

            # Query only. "boardtype <name>" would walk the chip's one-way counter, which cannot
            # be undone, so no argument is ever sent here.
            ser.write(b"boardtype\r\n")
            ser.flush()

            collected = ""
            deadline = time.monotonic() + deadline_s
            while time.monotonic() < deadline:
                chunk = ser.read(256)
                if chunk:
                    collected += chunk.decode("utf-8", errors="replace")
                    found = parse_board_type(collected)
                    if found:
                        print(f"[bao] boardtype: {found}")
                        return 0
                else:
                    time.sleep(0.02)
    except Exception as e:
        logging.error(f"boardtype query failed on {port}: {e}")
        return 1

    logging.error(f"no board type reported on {port} within {deadline_s}s")
    return 3


def register(subparsers: argparse._SubParsersAction) -> None:
    boardtype = subparsers.add_parser(
        "boardtype",
        help="Ask the bootloader which board this is (query only; never sets the type)"
    )
    boardtype.add_argument("-p", "--port", required=True, help="Bootloader serial port (e.g., COM7, /dev/ttyACM0)")
    boardtype.add_argument("-b", "--baud", type=int, default=DEFAULT_BAUD, help="Baud rate (default 1000000)")
    boardtype.add_argument(
        "-s",
        "--settle",
        type=float,
        default=DEFAULT_SETTLE_S,
        help=f"Seconds to wait after opening the port before sending (default {DEFAULT_SETTLE_S})",
    )
    boardtype.add_argument(
        "-t",
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_S,
        help=f"Seconds to wait for the reply (default {DEFAULT_TIMEOUT_S})",
    )
    boardtype.set_defaults(func=cmd_boardtype)

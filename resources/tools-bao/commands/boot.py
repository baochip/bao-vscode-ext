import argparse
import time
import logging
from serial.serialutil import SerialException
from utils.serial_utils import DEFAULT_BAUD, open_serial

# A USB CDC port that just enumerated can drop bytes written immediately after the open,
# losing the command with no error anywhere.
DEFAULT_SETTLE_S = 0.25

def cmd_boot(args: argparse.Namespace) -> int:
    port = args.port
    baud = args.baud
    settle = max(0.0, getattr(args, "settle", DEFAULT_SETTLE_S))
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
            # is parsed as "boot" and not as the tail of something else.
            ser.write(b"\r\n")
            ser.flush()

            # Send the boot command to leave bootloader mode and start firmware (run mode)
            ser.write(b"boot\r\n")
            ser.flush()
            # tiny grace period to ensure the device processes it
            time.sleep(0.1)
    except Exception as e:
        logging.error(f"boot command failed on {port}: {e}")
        return 1

    print(f"[bao] sent 'boot' on {port}")
    return 0


def register(subparsers: argparse._SubParsersAction) -> None:
    boot = subparsers.add_parser(
        "boot",
        help="Send 'boot' to the bootloader serial port to start run mode"
    )
    boot.add_argument("-p", "--port", required=True, help="Bootloader serial port (e.g., COM7, /dev/ttyACM0)")
    boot.add_argument("-b", "--baud", type=int, default=DEFAULT_BAUD, help="Baud rate (default 1000000)")
    boot.add_argument(
        "-s",
        "--settle",
        type=float,
        default=DEFAULT_SETTLE_S,
        help=f"Seconds to wait after opening the port before sending (default {DEFAULT_SETTLE_S})",
    )
    boot.set_defaults(func=cmd_boot)

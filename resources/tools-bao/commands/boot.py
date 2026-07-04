import argparse
import time
import logging
import serial
from utils.serial_utils import DEFAULT_BAUD

def cmd_boot(args: argparse.Namespace) -> int:
    port = args.port
    baud = args.baud
    try:
        ser = serial.Serial(port, baud, timeout=0.2)
    except Exception as e:
        logging.error(f"cannot open {port}: {e}")
        return 2

    try:
        with ser:
            try:
                ser.reset_input_buffer()
                ser.reset_output_buffer()
            except Exception:
                pass

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
    boot.set_defaults(func=cmd_boot)
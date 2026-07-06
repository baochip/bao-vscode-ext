import argparse
import sys
import os
import codecs
import contextlib
import logging
import threading
import time
from serial.serialutil import SerialException
from utils.serial_utils import DEFAULT_BAUD, open_serial, safe_close


@contextlib.contextmanager
def _stdin_raw_noecho():
    """Disable local echo & canonical mode so each keystroke is delivered immediately.
    Works on POSIX and Windows; restores terminal settings on exit."""
    if not sys.stdin.isatty():
        yield
        return

    if os.name == "posix":
        import termios
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            new = termios.tcgetattr(fd)
            # Turn off ECHO and ICANON (line buffering); keep CR as CR (no ICRNL)
            new[3] &= ~(termios.ECHO | termios.ICANON)   # lflags
            new[1] |= termios.OPOST                      # oflags: leave output processing on
            new[0] &= ~termios.ICRNL                     # iflags: don't map CR->NL
            # per-char reads (VMIN=1/VTIME=0); ISIG left on so Ctrl+C still raises KeyboardInterrupt
            new[6][termios.VMIN] = 1
            new[6][termios.VTIME] = 0
            termios.tcsetattr(fd, termios.TCSANOW, new)
            yield
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    else:
        # Windows
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.windll.kernel32
        hIn = kernel32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        old_mode = wintypes.DWORD()
        if hIn != ctypes.c_void_p(-1).value and kernel32.GetConsoleMode(hIn, ctypes.byref(old_mode)):
            try:
                new_mode = old_mode.value
                ENABLE_ECHO_INPUT = 0x0004
                ENABLE_LINE_INPUT = 0x0002
                # Keep PROCESSED_INPUT so Ctrl+C works as KeyboardInterrupt
                new_mode &= ~(ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT)
                kernel32.SetConsoleMode(hIn, new_mode)
                yield
            finally:
                kernel32.SetConsoleMode(hIn, old_mode)
        else:
            yield


def _stdin_to_serial(ser, args, stop_event: threading.Event, write_error: threading.Event):
    """Forward user input to the serial port (raw: per-byte, line: per-line)."""
    try:
        if args.raw:
            # Raw mode: per-byte. cmd_monitor (main thread) owns the terminal raw-mode; this
            # thread only reads stdin and writes to serial, so it never touches terminal state.
            while not stop_event.is_set():
                b = sys.stdin.buffer.read(1)
                if not b:
                    return  # stdin EOF: stop TX only, leave the RX loop capturing output
                try:
                    ser.write(b)
                    ser.flush()
                except SerialException:
                    write_error.set()
                    stop_event.set()
                    return
                # Local echo only if explicitly requested
                if args.echo:
                    try:
                        sys.stdout.write(b.decode(errors="replace"))
                        sys.stdout.flush()
                    except Exception:
                        pass
        else:
            # Line mode: read a full line, normalize line ending
            tx_eol = b"\r\n" if args.crlf else b"\n"
            while not stop_event.is_set():
                line = sys.stdin.buffer.readline()
                if not line:
                    return  # stdin EOF: stop TX only, leave the RX loop capturing output
                # Strip any trailing \r or \n to avoid doubling endings
                line = line.rstrip(b"\r\n")
                payload = line + tx_eol
                try:
                    ser.write(payload)
                    ser.flush()
                except SerialException:
                    write_error.set()
                    stop_event.set()
                    return
                if args.echo:
                    try:
                        sys.stdout.write(line.decode(errors="replace") + ("\r\n" if tx_eol == b"\r\n" else "\n"))
                        sys.stdout.flush()
                    except Exception:
                        pass
    except Exception as e:
        logging.debug(f"stdin writer thread ended: {e}")
        stop_event.set()  # an unexpected writer error stops the monitor

def cmd_monitor(args: argparse.Namespace) -> int:
    try:
        ser = open_serial(
            args.port,
            args.baud,
            timeout=0.1,
        )
    except SerialException as e:
        logging.error(str(e))  # exit 2 for an unopenable port, matching cmd_boot
        return 2
    outf = None
    if args.save:
        try:
            # binary + unbuffered: exact byte capture of the serial stream, no text-mode
            # CRLF translation, and the log stays current (was: text, line-buffered)
            outf = open(args.save, "ab", buffering=0)
        except Exception as e:
            logging.error(f"cannot open --save file: {e}")
            safe_close(ser)
            return 2

    print(f"[bao] Monitor {args.port} @ {args.baud} - interactive (Ctrl+C to exit)")
    mode = "RAW" if args.raw else ("LINE CRLF" if args.crlf else "LINE LF")
    echo = "ON" if args.echo else "OFF"
    print(f"[bao] TX:{mode}  Echo:{echo}")

    consecutive_errors = 0
    MAX_ERRORS = 15       # tolerate brief USB/UART glitches during firmware init
    RETRY_SLEEP_S = 0.05  # pause between error retries to avoid a hot error loop
    READ_CHUNK = 4096     # bytes to read from the serial port per iteration
    WRITER_JOIN_TIMEOUT_S = 0.5  # how long to wait for the stdin writer thread on exit
    IDLE_SLEEP_S = 0.01   # small yield when idle to avoid a hot loop
    stop_event = threading.Event()
    write_error = threading.Event()  # set by the writer thread if a serial write fails
    exit_code = 0  # nonzero when the monitor ends because of a failure (disconnect)

    # Persistent UTF-8 decoder so a multibyte char split across ser.read() chunks isn't corrupted.
    rx_decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

    # Own the terminal raw-mode on THIS (main) thread so the restore always runs, even on Ctrl+C:
    # the daemon writer thread can be killed mid-read, so it must NOT own terminal state.
    raw_ctx = _stdin_raw_noecho() if args.raw else contextlib.nullcontext()
    raw_ctx.__enter__()

    # Start stdin->serial writer thread
    writer = threading.Thread(
        target=_stdin_to_serial, args=(ser, args, stop_event, write_error), daemon=True
    )
    writer.start()

    try:
        while not stop_event.is_set():
            try:
                data = ser.read(READ_CHUNK)
                if data:
                    s = rx_decoder.decode(data)  # incremental: split multibyte chars stay intact
                    sys.stdout.write(s)
                    if outf:
                        outf.write(data)  # raw bytes: exact capture, no CRLF translation
                    sys.stdout.flush()
                consecutive_errors = 0
            except SerialException as e:
                consecutive_errors += 1
                logging.debug(f"Serial error ({consecutive_errors}/{MAX_ERRORS}): {e}")
                # Surface a sustained problem early (visible at the default log level),
                # but stay quiet for brief 1-2 error glitches during normal firmware init.
                if consecutive_errors == 3:
                    logging.warning("Serial read errors - the port may be disconnecting...")
                if consecutive_errors >= MAX_ERRORS:
                    logging.error("Too many serial errors - port may be disconnected.")
                    exit_code = 1
                    break
                time.sleep(RETRY_SLEEP_S)
                continue
            # Small yield to avoid a hot loop when idle
            if not stop_event.is_set():
                time.sleep(IDLE_SLEEP_S)
        # Report a writer-side disconnect (serial write failed) as a failure, not a clean exit.
        if write_error.is_set() and exit_code == 0:
            logging.error("Serial write failed - port may be disconnected.")
            exit_code = 1
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        # Cleanup must survive a second Ctrl+C: restore the terminal before the blocking join and
        # catch BaseException (KeyboardInterrupt) at each step.
        try:
            raw_ctx.__exit__(None, None, None)
        except BaseException:
            pass
        try:
            writer.join(timeout=WRITER_JOIN_TIMEOUT_S)
        except BaseException:
            pass
        try:
            if outf:
                outf.flush()
                outf.close()
        except BaseException:
            pass
        try:
            safe_close(ser)
        except BaseException:
            pass
    return exit_code


def register(subparsers: argparse._SubParsersAction) -> None:
    m = subparsers.add_parser("monitor", help="Open a serial monitor")
    m.add_argument("-p", "--port", required=True, help="Serial port (e.g., COM5, /dev/ttyUSB0)")
    m.add_argument("-b", "--baud", type=int, default=DEFAULT_BAUD, help="Baud rate")
    m.add_argument("--save", help="Append output to a file")
    # PuTTY-like defaults for direct CLI use; each flag has a --no-* form so it can
    # actually be turned off (store_true + True defaults made "off" unreachable).
    m.add_argument("--crlf", action=argparse.BooleanOptionalAction, default=True,
                   help="Use CRLF as TX line ending in line mode")  # Enter sends CRLF in line mode
    m.add_argument("--raw", action=argparse.BooleanOptionalAction, default=True,
                   help="Send keystrokes immediately (raw byte mode); --no-raw = line mode")  # per-keystroke
    m.add_argument("--echo", action=argparse.BooleanOptionalAction, default=False,
                   help="Locally echo typed input")  # off by default: device provides echo if any

    m.set_defaults(func=cmd_monitor)
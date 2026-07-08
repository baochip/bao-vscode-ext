"""Exit-code tests for the monitor command: failure paths must return nonzero so the
dispatcher (sys.exit(code or 0)) reports them - a failed monitor must not exit 0."""

import argparse
import logging
import threading

import pytest
from serial.serialutil import SerialException

from commands import monitor


class FakeSerial:
    """Minimal serial stand-in for the monitor's read loop."""

    def __init__(self, read_behavior):
        self.read_behavior = read_behavior
        self.closed = False

    def read(self, n):
        return self.read_behavior()

    def close(self):
        self.closed = True


@pytest.fixture
def quiet_writer(monkeypatch):
    """No-op the stdin->serial writer so its background stdin reads don't interfere with the
    RX-loop tests (the real thread would read pytest's captured stdin)."""
    monkeypatch.setattr(
        monitor, "_stdin_to_serial", lambda ser, args, stop_event, write_error: None
    )


def make_args(**overrides):
    base = dict(port="COM9", baud=1000000, save=None, raw=False, crlf=True, echo=False)
    base.update(overrides)
    return argparse.Namespace(**base)


def test_unopenable_port_returns_2(monkeypatch):
    def cannot_open(*a, **k):
        raise SerialException("cannot open COM9: no such port")

    monkeypatch.setattr(monitor, "open_serial", cannot_open)

    # An unopenable port exits 2 (like cmd_boot), not the generic 1 from bao.py's handler.
    assert monitor.cmd_monitor(make_args()) == 2


def test_unwritable_save_file_returns_2(monkeypatch, tmp_path):
    ser = FakeSerial(lambda: b"")
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    # a directory path cannot be opened as the --save file
    code = monitor.cmd_monitor(make_args(save=str(tmp_path)))

    assert code == 2
    assert ser.closed, "serial port released on the failure path"


def test_persistent_serial_errors_return_1(monkeypatch, quiet_writer):
    def explode():
        raise SerialException("device disconnected")

    ser = FakeSerial(explode)
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    code = monitor.cmd_monitor(make_args())

    assert code == 1
    assert ser.closed


def test_keyboard_interrupt_is_a_clean_exit(monkeypatch, quiet_writer):
    def interrupt():
        raise KeyboardInterrupt

    ser = FakeSerial(interrupt)
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    code = monitor.cmd_monitor(make_args())

    assert code == 0
    assert ser.closed


def _run_writer_at_stdin_eof(monkeypatch, raw):
    class _EofStdin:
        class buffer:
            @staticmethod
            def read(_n):
                return b""

            @staticmethod
            def readline():
                return b""

    monkeypatch.setattr(monitor.sys, "stdin", _EofStdin)
    stop_event = threading.Event()
    write_error = threading.Event()
    ser = FakeSerial(lambda: b"")
    monitor._stdin_to_serial(ser, make_args(raw=raw), stop_event, write_error)
    return stop_event, write_error


@pytest.mark.parametrize("raw", [True, False])
def test_stdin_eof_stops_tx_not_the_rx_loop(monkeypatch, raw):
    # On stdin EOF the writer ends without stopping the monitor, so a non-interactive --save run
    # keeps capturing RX output.
    stop_event, write_error = _run_writer_at_stdin_eof(monkeypatch, raw)
    assert not stop_event.is_set(), "stdin EOF must not stop the RX loop"
    assert not write_error.is_set()


def test_line_mode_normalizes_to_crlf_and_echoes(monkeypatch, capsys):
    """Line mode strips the incoming EOL and TXes a single CRLF: a bare LF becomes CRLF and an
    existing CRLF is not doubled. With echo on, the typed line is mirrored locally with CRLF."""

    class _LinesStdin:
        class buffer:
            _queue = [b"hello\r\n", b"world\n", b""]

            @staticmethod
            def readline():
                return _LinesStdin.buffer._queue.pop(0)

    written = []

    class WriteSerial:
        def write(self, b):
            written.append(b)

        def flush(self):
            pass

    monkeypatch.setattr(monitor.sys, "stdin", _LinesStdin)
    stop_event = threading.Event()
    write_error = threading.Event()

    monitor._stdin_to_serial(
        WriteSerial(), make_args(raw=False, crlf=True, echo=True), stop_event, write_error
    )

    assert b"".join(written) == b"hello\r\nworld\r\n", "each line TXed with a single CRLF"
    assert not write_error.is_set()
    assert capsys.readouterr().out == "hello\r\nworld\r\n", "echo mirrors the lines with CRLF"


def test_writer_serial_failure_exits_1_with_a_message(monkeypatch, caplog):
    """A disconnect on the write side (typing) must exit nonzero with a message, like the read
    side - not the silent exit 0 of a normal stdin EOF."""

    def failing_writer(ser, args, stop_event, write_error):
        write_error.set()
        stop_event.set()

    monkeypatch.setattr(monitor, "_stdin_to_serial", failing_writer)
    ser = FakeSerial(lambda: b"")  # read yields nothing; the loop ends when the writer stops it
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    with caplog.at_level(logging.ERROR):
        code = monitor.cmd_monitor(make_args())

    assert code == 1
    assert ser.closed
    assert any("disconnect" in r.message.lower() for r in caplog.records)


def test_second_ctrl_c_during_cleanup_still_restores_terminal(monkeypatch):
    """A first Ctrl+C ends the read loop; a second Ctrl+C landing during the writer join in
    cleanup must not skip restoring the terminal (which would leave the shell stuck in raw mode)."""

    class SpyRawCtx:
        def __init__(self):
            self.exited = False

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.exited = True
            return False

    spy_ctx = SpyRawCtx()
    monkeypatch.setattr(monitor, "_stdin_raw_noecho", lambda: spy_ctx)

    class InterruptingWriter:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            pass

        def join(self, timeout=None):
            raise KeyboardInterrupt  # the second Ctrl+C arrives during the join

    monkeypatch.setattr(monitor.threading, "Thread", InterruptingWriter)

    def first_interrupt():
        raise KeyboardInterrupt

    ser = FakeSerial(first_interrupt)
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    code = monitor.cmd_monitor(make_args(raw=True))

    assert spy_ctx.exited, "terminal restored despite a 2nd Ctrl+C during the writer join"
    assert ser.closed, "serial port still closed"
    assert code == 0


def test_writer_start_failure_still_restores_terminal_and_port(monkeypatch):
    """If the writer thread fails to start (e.g. OS thread exhaustion) after raw-mode is entered,
    cleanup must still restore the terminal and release the port instead of leaking them."""

    class SpyRawCtx:
        def __init__(self):
            self.exited = False

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.exited = True
            return False

    spy_ctx = SpyRawCtx()
    monkeypatch.setattr(monitor, "_stdin_raw_noecho", lambda: spy_ctx)

    class FailingWriter:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            raise RuntimeError("can't start new thread")

        def join(self, timeout=None):
            pass

    monkeypatch.setattr(monitor.threading, "Thread", FailingWriter)

    ser = FakeSerial(lambda: b"")
    monkeypatch.setattr(monitor, "open_serial", lambda *a, **k: ser)

    with pytest.raises(RuntimeError):
        monitor.cmd_monitor(make_args(raw=True))

    assert spy_ctx.exited, "terminal restored despite the writer failing to start"
    assert ser.closed, "serial port released despite the writer failing to start"

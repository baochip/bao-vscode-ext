"""Tests for utils.serial_utils and the boot command against a fake serial port,
pinning down the line-state handling and the exact bytes sent to the bootloader."""

import argparse
import time

import pytest
import serial
from serial.serialutil import SerialException

from commands import boot
from utils.serial_utils import open_serial, safe_close


class FakeSerial:
    """Stand-in for serial.Serial recording line-state changes, writes, and closes."""

    def __init__(self, port=None, baudrate=None, timeout=None, **kwargs):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.dtr_history = []
        self.rts_history = []
        self.written = []
        self.flush_count = 0
        self.input_resets = 0
        self.output_resets = 0
        self.closed = False
        self.write_error = None

    @property
    def dtr(self):
        return self.dtr_history[-1] if self.dtr_history else None

    @dtr.setter
    def dtr(self, value):
        self.dtr_history.append(value)

    @property
    def rts(self):
        return self.rts_history[-1] if self.rts_history else None

    @rts.setter
    def rts(self, value):
        self.rts_history.append(value)

    def write(self, data):
        if self.write_error:
            raise self.write_error
        self.written.append(data)
        return len(data)

    def flush(self):
        self.flush_count += 1

    def reset_input_buffer(self):
        self.input_resets += 1

    def reset_output_buffer(self):
        self.output_resets += 1

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


@pytest.fixture
def no_sleep(monkeypatch, fake_serial):
    """Record (duration, writes so far) instead of sleeping, so timing order is assertable."""
    calls = []

    def record(seconds):
        written = len(fake_serial[0].written) if fake_serial else 0
        calls.append((seconds, written))

    monkeypatch.setattr(time, "sleep", record)
    return calls


@pytest.fixture
def fake_serial(monkeypatch):
    created = []

    def factory(*args, **kwargs):
        fake = FakeSerial(*args, **kwargs)
        created.append(fake)
        return fake

    # Both utils.serial_utils and commands.boot resolve serial.Serial through the
    # shared serial module, so one patch covers them all.
    monkeypatch.setattr(serial, "Serial", factory)
    return created


def test_open_serial_releases_control_lines_and_clears_buffers(fake_serial):
    ser = open_serial("COM9", 1000000)

    assert ser is fake_serial[0]
    assert ser.port == "COM9"
    assert ser.baudrate == 1000000
    assert ser.dtr is False and ser.rts is False, "DTR/RTS released after open"
    assert ser.input_resets == 1 and ser.output_resets == 1, "pending bytes cleared"


def test_open_serial_reset_pulses_the_control_lines(fake_serial):
    ser = open_serial("COM9", 1000000, reset=True)

    assert ser.dtr_history == [False, True, False], "release, assert, release"
    assert ser.rts_history == [False, True, False]


def test_open_serial_wraps_failures_in_serial_exception(monkeypatch):
    def explode(*args, **kwargs):
        raise OSError("access denied")

    monkeypatch.setattr(serial, "Serial", explode)

    with pytest.raises(SerialException, match="cannot open COM9"):
        open_serial("COM9", 1000000)


def test_safe_close_tolerates_none_and_close_errors():
    safe_close(None)  # no-op

    class Exploding:
        def close(self):
            raise OSError("already gone")

    safe_close(Exploding())  # swallowed


def test_cmd_boot_sends_the_boot_command_and_flushes(fake_serial, no_sleep, capsys):
    code = boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000))

    assert code == 0
    ser = fake_serial[0]
    assert ser.written == [b"\r\n", b"boot\r\n"], "line terminator, then the bootloader payload"
    assert ser.flush_count == 2
    assert ser.closed, "port closed after sending"
    assert "sent 'boot' on COM9" in capsys.readouterr().out


def test_cmd_boot_releases_the_control_lines(fake_serial, no_sleep):
    boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000))

    ser = fake_serial[0]
    assert ser.dtr is False and ser.rts is False, "DTR/RTS released, as the monitor does"
    assert ser.input_resets == 1 and ser.output_resets == 1, "pending bytes cleared"


def test_cmd_boot_settles_after_opening_before_it_writes(fake_serial, no_sleep):
    boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000))

    # (duration, writes issued so far) - the settle must land before the payload
    assert no_sleep == [(boot.DEFAULT_SETTLE_S, 0), (0.1, 2)]


def test_cmd_boot_settle_is_configurable_and_skippable(fake_serial, no_sleep):
    boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000, settle=1.5))
    assert no_sleep[0] == (1.5, 0)

    no_sleep.clear()
    boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000, settle=0))
    assert no_sleep[0][0] == 0.1, "no settle sleep at all, straight to the grace period"


def test_cmd_boot_clamps_a_negative_settle(fake_serial, no_sleep):
    boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000, settle=-5))

    assert no_sleep[0][0] == 0.1, "negative settle behaves as none"


def test_cmd_boot_returns_2_when_the_port_cannot_be_opened(monkeypatch):
    def explode(*args, **kwargs):
        raise OSError("access denied")

    monkeypatch.setattr(serial, "Serial", explode)

    code = boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000))

    assert code == 2


def test_cmd_boot_returns_1_when_the_write_fails(monkeypatch):
    def failing_factory(*args, **kwargs):
        fake = FakeSerial(*args, **kwargs)
        fake.write_error = SerialException("device unplugged")
        return fake

    monkeypatch.setattr(serial, "Serial", failing_factory)

    code = boot.cmd_boot(argparse.Namespace(port="COM9", baud=1000000))

    assert code == 1

"""Tests for the `ports` command's output formatting against a faked pyserial port list."""

import argparse

from commands import ports


class FakePort:
    def __init__(self, device, description, vid=None, pid=None):
        self.device = device
        self.description = description
        self.vid = vid
        self.pid = pid


def run_ports(monkeypatch, fake_ports):
    monkeypatch.setattr(ports.list_ports, "comports", lambda: list(fake_ports))
    return ports.cmd_ports(argparse.Namespace(verbose=False))


def test_lists_ports_as_tab_separated_device_and_description(monkeypatch, capsys):
    run_ports(monkeypatch, [FakePort("COM7", "Baochip Dabao")])

    out = capsys.readouterr().out.strip()
    assert out == "COM7\tBaochip Dabao"


def test_appends_vid_pid_when_present(monkeypatch, capsys):
    run_ports(monkeypatch, [FakePort("/dev/ttyUSB0", "USB Serial", vid=0x1209, pid=0xDB00)])

    out = capsys.readouterr().out.strip()
    assert out == "/dev/ttyUSB0\tUSB Serial (VID:PID=1209:db00)"


def test_no_ports_warns_and_prints_nothing_to_stdout(monkeypatch, capsys, caplog):
    import logging

    with caplog.at_level(logging.WARNING):
        run_ports(monkeypatch, [])

    assert capsys.readouterr().out.strip() == "", "nothing on stdout when there are no ports"
    assert any("No serial ports found" in r.message for r in caplog.records)

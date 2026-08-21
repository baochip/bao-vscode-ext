"""Tests for the `boardtype` command: reply parsing, and that it only ever queries."""

from commands import boardtype
from conftest import run_bao


def test_parses_the_bootloader_reply():
    assert boardtype.parse_board_type("Board type is set to: Dabao") == "dabao"


def test_parses_a_reply_buried_in_other_output():
    noisy = "bao1x boot1\r\nboardtype\r\nBoard type is set to: Baosec\r\n> "
    assert boardtype.parse_board_type(noisy) == "baosec"


def test_parses_the_oem_variant():
    assert boardtype.parse_board_type("Board type is set to: Oem") == "oem"


def test_returns_none_when_the_reply_is_absent():
    assert boardtype.parse_board_type("unknown command\r\n> ") is None


def test_rejects_a_board_type_argument():
    """Setting the type walks a one-way counter, so the CLI must not accept one to forward."""
    r = run_bao("boardtype", "-p", "COM_NONE", "dabao")

    assert r.returncode != 0
    assert "unrecognized arguments" in r.stderr

"""Parser-level tests for the monitor's crlf/raw/echo flags. These are the knobs the
extension's monitor settings map to, so every form must parse to the value the user chose
(store_true + True defaults previously made the off state unreachable)."""

import argparse

from commands import monitor


def parse(*flags):
    parser = argparse.ArgumentParser()
    monitor.register(parser.add_subparsers())
    return parser.parse_args(["monitor", "-p", "PORT", *flags])


def test_defaults_are_putty_style():
    args = parse()

    assert args.raw is True
    assert args.crlf is True
    assert args.echo is False


def test_every_flag_can_be_turned_off():
    args = parse("--no-raw", "--no-crlf", "--echo")

    assert args.raw is False
    assert args.crlf is False
    assert args.echo is True


def test_positive_forms_still_parse():
    # The forms older extension versions send; must keep parsing identically.
    args = parse("--raw", "--crlf", "--no-echo")

    assert args.raw is True
    assert args.crlf is True
    assert args.echo is False

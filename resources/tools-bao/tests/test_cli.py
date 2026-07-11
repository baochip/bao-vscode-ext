"""Smoke tests for the bao.py dispatcher as a subprocess. bao.py imports every command
module at startup, so a syntax or import error in any of them breaks every command -
the --help runs alone catch that whole class of breakage."""

import pytest
from conftest import run_bao

NO_SUCH_PORT = "BAO_TEST_NO_SUCH_PORT"


def test_help_lists_every_command():
    result = run_bao("--help")

    assert result.returncode == 0
    for command in ("app", "boot", "monitor", "ports"):
        assert command in result.stdout, f"{command} missing from --help"


@pytest.mark.parametrize("command", ["app", "boot", "monitor", "ports"])
def test_each_command_help_works(command):
    result = run_bao(command, "--help")

    assert result.returncode == 0, f"{command} --help failed: {result.stderr}"


def test_no_command_exits_nonzero():
    result = run_bao()

    assert result.returncode == 2, "argparse rejects a missing subcommand"


def test_boot_with_unopenable_port_exits_2():
    result = run_bao("boot", "-p", NO_SUCH_PORT)

    assert result.returncode == 2
    assert "cannot open" in result.stderr


def test_verbose_adds_a_traceback_without_duplicating_the_error(tmp_path):
    # An unexpected error (reading a directory as a TOML file) reaches the dispatcher's top-level
    # handler: the error is printed exactly once, with a traceback only under --verbose.
    args = ("app", "update-rev", "--file", str(tmp_path), "--rev", "abc1234")
    verbose = run_bao("-v", *args)
    assert verbose.returncode == 1
    assert verbose.stderr.count("[bao] error:") == 1, "error printed exactly once"
    assert "Traceback" in verbose.stderr

    quiet = run_bao(*args)
    assert quiet.stderr.count("[bao] error:") == 1
    assert "Traceback" not in quiet.stderr, "traceback only with --verbose"


def test_monitor_with_unopenable_port_reports_and_exits_0():
    # The monitor reports its problems interactively and always exits 0, so editors never stack
    # a terminal exit-code notification on top of the message (boot, being scriptable, keeps 2).
    result = run_bao("monitor", "-p", NO_SUCH_PORT)

    assert result.returncode == 0
    assert "cannot open" in result.stderr

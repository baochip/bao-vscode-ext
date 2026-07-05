"""Smoke tests for the bao.py dispatcher as a subprocess. bao.py imports every command
module at startup, so a syntax or import error in any of them breaks every command -
the --help runs alone catch that whole class of breakage."""

import subprocess
import sys
from pathlib import Path

import pytest

TOOLS_ROOT = Path(__file__).resolve().parent.parent
BAO = TOOLS_ROOT / "bao.py"
NO_SUCH_PORT = "BAO_TEST_NO_SUCH_PORT"


def run_bao(*args):
    return subprocess.run(
        [sys.executable, str(BAO), *args],
        cwd=str(TOOLS_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )


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


def test_verbose_adds_a_traceback_without_duplicating_the_error():
    verbose = run_bao("-v", "monitor", "-p", NO_SUCH_PORT)
    assert verbose.returncode == 1
    assert verbose.stderr.count("[bao] error:") == 1, "error printed exactly once"
    assert "Traceback" in verbose.stderr

    quiet = run_bao("monitor", "-p", NO_SUCH_PORT)
    assert quiet.stderr.count("[bao] error:") == 1
    assert "Traceback" not in quiet.stderr, "traceback only with --verbose"


def test_monitor_with_unopenable_port_exits_1_via_dispatcher():
    # open_serial raises; the dispatcher's top-level handler must turn that into
    # a readable error and a nonzero exit (the other half of the exit-code fix).
    result = run_bao("monitor", "-p", NO_SUCH_PORT)

    assert result.returncode == 1
    assert "[bao] error:" in result.stderr
    assert "cannot open" in result.stderr

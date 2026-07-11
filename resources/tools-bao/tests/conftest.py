import subprocess
import sys
from pathlib import Path

# Make the CLI's modules (commands.*, utils.*) importable from the tests, the same way
# bao.py resolves them when run from the tools root.
TOOLS_ROOT = Path(__file__).resolve().parent.parent
if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

BAO = TOOLS_ROOT / "bao.py"


def run_bao(*args, **kwargs):
    """Run bao.py as a subprocess so process exit codes are part of the contract."""
    return subprocess.run(
        [sys.executable, str(BAO), *args],
        cwd=str(TOOLS_ROOT),
        capture_output=True,
        text=True,
        **kwargs,
    )

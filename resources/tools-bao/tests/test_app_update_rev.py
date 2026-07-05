"""Tests for `bao.py app update-rev`, run against the CLI as a subprocess so the
process exit codes are part of the contract (a failed update must exit nonzero
for the extension to detect it)."""

import subprocess
import sys
from pathlib import Path

TOOLS_ROOT = Path(__file__).resolve().parent.parent
BAO = TOOLS_ROOT / "bao.py"
REV = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
OLD_REV = "0000000000000000000000000000000000000000"


def run_update_rev(file_path, rev=REV):
    return subprocess.run(
        [sys.executable, str(BAO), "app", "update-rev", "--file", str(file_path), "--rev", rev],
        cwd=str(TOOLS_ROOT),
        capture_output=True,
        text=True,
    )


def write_toml(tmp_path, content):
    file_path = tmp_path / "Cargo.toml"
    file_path.write_text(content, encoding="utf-8")
    return file_path


def test_updates_every_xous_core_dependency(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[package]\n'
        'name = "my_app"\n'
        '\n'
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n'
        f'bio-lib = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    assert f"updated xous-core rev to {REV}" in result.stdout
    updated = file_path.read_text(encoding="utf-8")
    assert updated.count(f'rev = "{REV}"') == 2
    assert OLD_REV not in updated


def test_updates_workspace_dependencies(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[workspace]\n'
        'members = ["app"]\n'
        '\n'
        '[workspace.dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    assert f'rev = "{REV}"' in file_path.read_text(encoding="utf-8")


def test_updates_aliased_dependency(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dependencies]\n'
        'xous-names = { package = "xous-api-names", '
        f'git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    assert f'rev = "{REV}"' in file_path.read_text(encoding="utf-8")


def test_replaces_branch_and_tag_pins_with_the_rev(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dependencies]\n'
        'bao1x-api = { git = "https://github.com/betrusted-io/xous-core", branch = "main" }\n'
        'bio-lib = { git = "https://github.com/betrusted-io/xous-core", tag = "v0.9" }\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    updated = file_path.read_text(encoding="utf-8")
    assert updated.count(f'rev = "{REV}"') == 2
    # cargo allows only one of branch/tag/rev on a git dependency
    assert "branch" not in updated and "tag" not in updated


def test_leaves_other_git_dependencies_alone(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n'
        f'other-lib = {{ git = "https://github.com/example/other-repo", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    updated = file_path.read_text(encoding="utf-8")
    assert f'other-lib = {{ git = "https://github.com/example/other-repo", rev = "{OLD_REV}" }}' in updated


def test_ignores_sibling_repos_with_a_xous_core_prefix(tmp_path):
    content = (
        '[dependencies]\n'
        f'core-utils = {{ git = "https://github.com/betrusted-io/xous-core-utils", rev = "{OLD_REV}" }}\n'
    )
    file_path = write_toml(tmp_path, content)

    result = run_update_rev(file_path)

    assert result.returncode == 2, "a sibling repo must not count as a match"
    assert file_path.read_text(encoding="utf-8") == content, "file untouched"


def test_matches_the_dot_git_url_form(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core.git", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    assert f'rev = "{REV}"' in file_path.read_text(encoding="utf-8")


def test_updates_dev_build_and_target_dependency_sections(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dev-dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n'
        '\n'
        '[build-dependencies]\n'
        f'bio-lib = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n'
        '\n'
        "[target.'cfg(unix)'.dependencies]\n"
        f'usb-bao1x = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    updated = file_path.read_text(encoding="utf-8")
    assert updated.count(f'rev = "{REV}"') == 3, "all three sections updated"
    assert OLD_REV not in updated


def test_reads_a_cargo_toml_with_a_bom(tmp_path):
    file_path = tmp_path / "Cargo.toml"
    file_path.write_text(
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
        encoding="utf-8-sig",
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    assert f'rev = "{REV}"' in file_path.read_text(encoding="utf-8")


def test_missing_file_exits_nonzero(tmp_path):
    result = run_update_rev(tmp_path / "does-not-exist" / "Cargo.toml")

    assert result.returncode == 2
    assert "file not found" in result.stderr


def test_no_matching_dependency_exits_nonzero(tmp_path):
    content = '[dependencies]\nserde = { version = "1" }\n'
    file_path = write_toml(tmp_path, content)

    result = run_update_rev(file_path)

    assert result.returncode == 2
    assert "no dependency" in result.stderr
    assert file_path.read_text(encoding="utf-8") == content, "file untouched on failure"


def test_write_leaves_no_temp_file_behind(tmp_path):
    file_path = write_toml(
        tmp_path,
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    # the atomic write goes through a sibling .tmp file that must be replaced away
    assert list(tmp_path.glob("*.tmp")) == []


def test_preserves_comments_and_formatting(tmp_path):
    file_path = write_toml(
        tmp_path,
        '# keep this header comment\n'
        '[package]\n'
        'name = "my_app"   # trailing comment\n'
        '\n'
        '[dependencies]\n'
        f'bao1x-api = {{ git = "https://github.com/betrusted-io/xous-core", rev = "{OLD_REV}" }}\n',
    )

    result = run_update_rev(file_path)

    assert result.returncode == 0
    updated = file_path.read_text(encoding="utf-8")
    assert "# keep this header comment" in updated
    assert 'name = "my_app"   # trailing comment' in updated

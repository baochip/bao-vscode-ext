import threading

from utils.toml_utils import write_file


def test_write_file_writes_content_and_leaves_no_temp(tmp_path):
    dest = tmp_path / "Cargo.toml"
    write_file(dest, "hello = 1\n")
    assert dest.read_text(encoding="utf-8") == "hello = 1\n"
    assert list(tmp_path.glob("*.tmp")) == [], "no temp file left behind"


def test_concurrent_writes_to_same_path_do_not_collide(tmp_path):
    # A unique temp name lets two writers to the same file finish without clobbering each other's
    # temp; the destination ends up as one intact copy, never a truncated mix, with no temps left.
    dest = tmp_path / "Cargo.toml"
    a = "a = 1\n" * 500
    b = "b = 2\n" * 500

    def writer(content):
        for _ in range(25):
            write_file(dest, content)

    t1 = threading.Thread(target=writer, args=(a,))
    t2 = threading.Thread(target=writer, args=(b,))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert dest.read_text(encoding="utf-8") in (a, b), "destination is one intact copy"
    assert list(tmp_path.glob("*.tmp")) == [], "no temp files left behind"

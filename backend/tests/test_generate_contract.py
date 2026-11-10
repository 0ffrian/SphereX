"""The contract generator writes the same bytes on every platform (D-18, issue #79)."""

from __future__ import annotations

from pathlib import Path

from scripts.generate_contract import OUTPUT_DIR, _to_lf, differences, generate


def test_to_lf_rewrites_every_crlf_file(tmp_path: Path) -> None:
    (tmp_path / "__init__.py").write_bytes(b"x = 1\r\ny = 2\r\n")
    (tmp_path / "b.py").write_bytes(b"x = 1\r\ny = 2\r\n")
    (tmp_path / "c.py").write_bytes(b"x = 1\ny = 2\n")
    _to_lf(tmp_path)
    assert (tmp_path / "__init__.py").read_bytes() == b"x = 1\ny = 2\n"
    assert (tmp_path / "b.py").read_bytes() == b"x = 1\ny = 2\n"
    assert (tmp_path / "c.py").read_bytes() == b"x = 1\ny = 2\n"


def test_generate_writes_lf_and_matches_the_committed_contract(tmp_path: Path) -> None:
    fresh = tmp_path / "c"
    generate(fresh)
    files = sorted(fresh.glob("*.py"))
    assert files
    assert all(b"\r" not in p.read_bytes() for p in files)
    assert differences(fresh, OUTPUT_DIR) == []


def test_differences_is_byte_exact(tmp_path: Path) -> None:
    fresh, committed = tmp_path / "fresh", tmp_path / "committed"
    fresh.mkdir()
    committed.mkdir()
    (fresh / "a.py").write_bytes(b"x = 1\r\n")
    (committed / "a.py").write_bytes(b"x = 1\n")
    (fresh / "same.py").write_bytes(b"y = 2\n")
    (committed / "same.py").write_bytes(b"y = 2\n")
    assert differences(fresh, committed) == ["a.py"]
    (fresh / "a.py").write_bytes(b"x = 1\n")
    assert differences(fresh, committed) == []
    (fresh / "only_fresh.py").write_bytes(b"")
    (committed / "only_committed.py").write_bytes(b"")
    assert differences(fresh, committed) == ["only_committed.py", "only_fresh.py"]


def test_committed_contract_is_lf() -> None:
    files = sorted(OUTPUT_DIR.glob("*.py"))
    assert files
    assert all(b"\r" not in p.read_bytes() for p in files)

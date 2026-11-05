"""Generate ``app/contract/`` from ``shared/schemas/`` (D-18).

    uv run python -m scripts.generate_contract           # rewrite the generated files
    uv run python -m scripts.generate_contract --check   # exit 1 if they differ (CI)

The output is byte-stable: the header has no timestamp and no path, and ruff formats it here with
this project's settings, so regenerating reproduces the committed bytes.
"""

from __future__ import annotations

import argparse
import filecmp
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = BACKEND_DIR.parent / "shared" / "schemas"
OUTPUT_DIR = BACKEND_DIR / "app" / "contract"
HEADER = "# GENERATED from shared/schemas/ by scripts/generate_contract.py (D-18). Do not edit."


def _run(*args: str) -> None:
    env = {**os.environ, "RUFF_NO_CACHE": "true"}
    subprocess.run([sys.executable, "-m", *args], cwd=BACKEND_DIR, env=env, check=True)


def generate(out_dir: Path) -> None:
    _run(
        "datamodel_code_generator",
        *("--input", str(SCHEMAS_DIR)),
        *("--input-file-type", "jsonschema"),
        *("--output", str(out_dir)),
        *("--output-model-type", "pydantic_v2.BaseModel"),
        *("--target-python-version", "3.12"),
        *("--custom-file-header", HEADER),
        "--disable-timestamp",
        "--use-standard-collections",
        "--use-union-operator",
        "--field-constraints",
        *("--extra-fields", "forbid"),
        "--use-title-as-name",
        *("--enum-field-as-literal", "all"),
        "--use-type-alias",
        *("--formatters", "ruff-format"),
    )
    config = str(BACKEND_DIR / "pyproject.toml")
    # E501 is ignored for app/contract/ in pyproject.toml; that glob does not match the temp dir.
    _run("ruff", "check", "--config", config, "--ignore", "E501", "--fix", "--quiet", str(out_dir))
    _run("ruff", "format", "--config", config, "--quiet", str(out_dir))


def _names(directory: Path) -> set[str]:
    return {p.name for p in directory.glob("*.py")} if directory.is_dir() else set()


def differences(fresh: Path, committed: Path) -> list[str]:
    fresh_names, committed_names = _names(fresh), _names(committed)
    both = sorted(fresh_names & committed_names)
    changed = filecmp.cmpfiles(fresh, committed, both, shallow=False)[1]
    return sorted({*changed, *(fresh_names ^ committed_names)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the files would change")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        fresh = Path(tmp) / "contract"
        generate(fresh)
        if args.check:
            drift = differences(fresh, OUTPUT_DIR)
            if drift:
                names = ", ".join(drift)
                print(f"contract drift in app/contract/: {names}", file=sys.stderr)
                print("Run: uv run python -m scripts.generate_contract", file=sys.stderr)
                return 1
            print("app/contract/ matches shared/schemas/")
            return 0
        OUTPUT_DIR.mkdir(exist_ok=True)
        for stale in OUTPUT_DIR.glob("*.py"):
            stale.unlink()
        for path in fresh.glob("*.py"):
            shutil.copyfile(path, OUTPUT_DIR / path.name)
    print(f"wrote {OUTPUT_DIR.relative_to(BACKEND_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

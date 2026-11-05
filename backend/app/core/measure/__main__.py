"""Per-target spectrum report on the configured cache (Done-when step 2).

    SX_OFFLINE=1 uv run python -m app.core.measure [--only NAME] [--group test]

Exit code 1 if a target has neither a measured point nor an all-saturated refusal.
"""

from __future__ import annotations

import argparse
import tomllib

from app.context import make_context
from app.core.find.frames import FrameService
from app.core.find.resolver import load_aliases, resolve
from app.core.measure.spectrum import SpectrumService, report_targets
from app.settings import get_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--only", action="append", help="target name; repeatable")
    p.add_argument("--group", action="append", default=None, help="default: test")
    args = p.parse_args(argv)
    s = get_settings()
    ctx = make_context(s)
    targets = tomllib.loads(s.targets_file.read_text(encoding="utf-8"))["target"]
    groups = set(args.group or ["test"])
    aliases = load_aliases(s.targets_file)
    chosen = [
        t for t in targets if t.get("group") in groups and (not args.only or t["name"] in args.only)
    ]
    objects = [(t["name"], resolve(ctx, t["query"], aliases).obj) for t in chosen]
    return 1 if report_targets(SpectrumService(FrameService(ctx)), objects) else 0


if __name__ == "__main__":
    raise SystemExit(main())

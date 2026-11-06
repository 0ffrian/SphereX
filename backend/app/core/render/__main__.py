"""Bake one card's textures.

    uv run python -m app.core.render ../shared/fixtures/cards/asteroid_procedural.json \
        --seed 2 --out /tmp/textures [--width 2048]
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from app.core.render.bake import BAKER_RULES_VERSION, bake_to_cache
from app.core.render.params import BakeRefusal, params_from_card


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("card", type=Path)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--version", default=BAKER_RULES_VERSION, help="generator_version path segment")
    ap.add_argument("--width", type=int, default=2048, help="height is width / 2")
    args = ap.parse_args(argv)
    card = json.loads(args.card.read_text(encoding="utf-8"))
    try:
        params = params_from_card(card, args.seed)
    except BakeRefusal as e:
        print(f"refused: {e.reason}; missing: {', '.join(e.missing)}")
        return 1
    out = bake_to_cache(params, args.out, card["id"], args.version, args.width, args.width // 2)
    for f in sorted(out.iterdir()):
        print(f"{hashlib.sha256(f.read_bytes()).hexdigest()[:16]}  {f}")
    if params.missing:
        print(f"baked flat (input missing): {', '.join(params.missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Bake the reference-object assets (issue #71 stream E, Q-258): Jupiter, Saturn, Titan, the Sun.

The cards come from ``app.core.card.reference`` (the same code the pipeline uses at run time).

    uv run python -m scripts.bake_reference_objects          # write assets/reference/ref-*.json
    uv run python -m scripts.bake_reference_objects --check  # exit 1 if a committed byte differs

Adds new assets only; the rest of the demo pack is untouched (re-baked once at integration).
"""

from __future__ import annotations

import argparse
import json
import sys

from app.core.card.assets import Asset
from app.core.card.reference import card_of, reference_rows
from app.core.render.card_to_params import GENERATOR_VERSION, card_to_params
from app.settings import Settings
from scripts.bake_demo_pack import ASSETS_DIR, _asset, asset_path


def build(settings: Settings) -> list[Asset]:
    rows = reference_rows(settings.reference_file)
    if not rows:
        raise SystemExit(f"no reference objects in {settings.reference_file}")
    out: list[Asset] = []
    for row in rows:
        card = card_of(row)
        params = card_to_params(card, generator_version=GENERATOR_VERSION)
        out.append(_asset(card, params, settings))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    bad = 0
    for asset in build(Settings()):
        path = ASSETS_DIR / "reference" / asset_path(asset).name
        text = json.dumps(asset.to_json(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                print(f"differs: {path}")
                bad += 1
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            print(f"wrote {path}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

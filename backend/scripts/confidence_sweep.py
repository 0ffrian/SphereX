"""Weights for the data-confidence score from a sensitivity sweep (D-36, Q-221).

    uv run python -m scripts.confidence_sweep            # every committed demo card

The tables in ``app/core/render/confidence.py`` are placeholders. This prints, per card, how much
of the rendered output depends on each card field: the field is set to unknown, the card goes
through stage 7 again, and the metric is the number of RenderParams leaf values that change (a
layer that disappears, a colour, a size). A field that moves nothing gets weight 0. It is a first,
cheap measure of "how much that quantity changes the picture"; replace the metric with the
distance between two baked textures (``core/render/bake.py``) for a finer one.

Limit: the metric only sees RenderParams. The mass, orbit and host-star inputs (and whatever else
the browser engines compute from the card: tides, climate, a star's spots) change the picture in
the frontend, not in RenderParams, so this sweep gives them weight 0 and cannot calibrate those
weights. Only asset files with a ``card`` are read (``tracks/horizons-*.json`` are paths, not
assets).
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.core.render.card_to_params import card_to_params
from app.core.render.confidence import _present_gas, sweep_weights

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def leaves(x: Any, prefix: str = "") -> dict[str, str]:
    if isinstance(x, Mapping):
        out: dict[str, str] = {}
        for k, v in x.items():
            out.update(leaves(v, f"{prefix}/{k}"))
        return out
    if isinstance(x, list):
        out = {}
        for i, v in enumerate(x):
            out.update(leaves(v, f"{prefix}[{i}]"))
        return out
    return {prefix: json.dumps(x, sort_keys=True)}


def sweep_card(card: Mapping[str, Any]) -> dict[str, float]:
    def render(c: Mapping[str, Any]) -> dict[str, str]:
        p = card_to_params(c, seed=0)
        p.pop("confidence", None)  # the score is not part of the picture
        p.pop("alt_text", None)
        return leaves(p)

    base = render(card)

    def metric(c: Mapping[str, Any]) -> float:
        other = render(c)
        keys = set(base) | set(other)
        return float(sum(1 for k in keys if base.get(k) != other.get(k)))

    fields = [
        k
        for k, v in card.items()
        if isinstance(v, Mapping)
        and (_present_gas(v) if k == "gas_Q" else v.get("value") is not None)
    ]
    # metric() is the distance to the full card, so the base of sweep_weights (0) is exact.
    return sweep_weights(card, metric, fields)


def main() -> int:
    for path in sorted(ASSETS.glob("*/*.json")):
        doc = json.loads(path.read_text("utf-8"))
        card = doc.get("card") if isinstance(doc, Mapping) else None
        if not isinstance(card, Mapping) or card.get("type") == "candidate":
            continue
        print(f"{card['id']} ({card['type']})")
        for field, w in sorted(sweep_card(card).items(), key=lambda kv: -kv[1]):
            print(f"  {field:24s} {w:6.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

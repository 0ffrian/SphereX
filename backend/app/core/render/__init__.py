"""Texture baker (CPU): equirectangular height, normal and albedo maps (R6, issue #6).

Public entry points: ``params_from_card`` (R6.2 generator rules), ``bake`` (maps in memory) and
``bake_to_cache`` (R6.7 files on disk).
"""

from app.core.render.bake import (
    BAKER_RULES_VERSION,
    BakeResult,
    bake,
    bake_to_cache,
    encode,
    texture_dir,
)
from app.core.render.params import BakeParams, BakeRefusal, params_from_card

__all__ = [
    "BAKER_RULES_VERSION",
    "BakeParams",
    "BakeRefusal",
    "BakeResult",
    "bake",
    "bake_to_cache",
    "encode",
    "params_from_card",
    "texture_dir",
]

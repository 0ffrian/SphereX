"""Pipeline stage 3 (A4.3): pick the ObjectType with the R3.3 rules and a class label."""

from app.core.classify.rules import (
    EXOPLANET_THRESHOLDS,
    CatalogueFacts,
    Classification,
    classify,
    classify_exoplanet,
)

__all__ = [
    "EXOPLANET_THRESHOLDS",
    "CatalogueFacts",
    "Classification",
    "classify",
    "classify_exoplanet",
]

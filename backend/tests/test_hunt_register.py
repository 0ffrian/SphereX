"""Issue #221 (A22.7.1): the hunt register and ``GET /v1/hunts``. Offline; the autouse guard in
conftest blocks the network."""

from __future__ import annotations

from typing import get_args

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

from app.contract.hunt_register_schema import HuntId, HuntRegister
from app.core.card.validate import ContractViolation, check, errors
from app.core.hunts.register import SCHEMA, register


def test_reply_validates_and_holds_every_hunt(client: TestClient) -> None:
    reply = client.get("/v1/hunts")
    assert reply.status_code == 200
    body = reply.json()
    check(body, SCHEMA)
    TypeAdapter(HuntRegister).validate_python(body)
    ids = [h["id"] for h in body]
    assert len(ids) == len(set(ids))
    assert set(ids) == set(get_args(get_args(HuntId.__value__)[0]))
    assert body == register()


def test_only_asteroids_is_available_and_the_rest_say_why() -> None:
    for hunt in register():
        availability = hunt["availability"]
        if hunt["id"] == "asteroids":
            assert availability == {"state": "available"}
        else:
            assert availability["state"] == "disabled"
            assert availability["reason"].startswith(f"hunt:{hunt['id']}:")
        assert hunt["calibration"] is None


# id: kind, level, weight, version (A22.2, A22.4.2, Q-529).
EXPECTED = {
    "variables": ("search", "experimental", "light", "0.0.0"),
    "cold_worlds": ("search", "experimental", "light", "0.0.0"),
    "asteroids": ("characterisation", "characterisation", "heavy", "1.0.0"),
    "runaways": ("search", "experimental", "light", "0.0.0"),
    "ir_excess": ("characterisation", "characterisation", "light", "0.0.0"),
    "dimmers": ("search", "experimental", "light", "0.0.0"),
    "active_asteroids": ("search", "experimental", "heavy", "0.0.0"),
    "slow_movers": ("search", "experimental", "heavy", "0.0.0"),
    "transients": ("context", "context", "light", "0.0.0"),
    "dark_companions": ("context", "context", "light", "0.0.0"),
}


def test_values_are_the_ones_of_the_spec_and_q529() -> None:
    hunts = register()
    got = {h["id"]: (h["kind"], h["level"], h["weight"], h["version"]) for h in hunts}
    assert got == EXPECTED
    for hunt in hunts:
        if hunt["id"] not in ("asteroids", "dark_companions"):
            assert hunt["availability"]["reason"] == f"hunt:{hunt['id']}:not_built"
        assert [r["id"] for r in hunt["routes"]] == (["vsx"] if hunt["id"] == "variables" else [])


def test_an_available_hunt_with_a_reason_is_rejected() -> None:
    body = register()
    body[2]["availability"] = {"state": "available", "reason": "hunt:asteroids:not_built"}
    assert errors(body, SCHEMA)


def test_dark_companions_waits_for_gaia_dr4() -> None:
    hunts = {h["id"]: h for h in register()}
    reason = hunts["dark_companions"]["availability"]["reason"]
    assert reason == "hunt:dark_companions:needs_release:gaia_dr4"


def test_no_search_hunt_is_validated_without_a_calibration() -> None:
    assert not [h for h in register() if h["level"] == "validated"]


def test_a_disabled_hunt_without_a_reason_is_rejected() -> None:
    body = register()
    body[0]["availability"] = {"state": "disabled"}
    assert errors(body, SCHEMA)
    with pytest.raises(ContractViolation):
        check(body, SCHEMA)


def test_callers_cannot_change_the_register() -> None:
    register()[0]["releases"].append("changed")
    assert "changed" not in register()[0]["releases"]

"""Punt-strategy helpers built on top of the z-score engine.

The live re-ranking for an arbitrary punt set is handled by
``zscore.compute_values(..., punt=[...])``. This module adds analysis on top:
which punts most help a *specific* player.
"""
from __future__ import annotations

from ..config import CATEGORY_KEYS
from .zscore import compute_values


def _find(results: list[dict], player_id) -> dict | None:
    for r in results:
        if r["id"] == player_id:
            return r
    return None


def best_punts_for_player(
    players: list[dict],
    player_id,
    pool: int,
    top: int = 4,
) -> dict:
    """For each single-category punt, report the player's resulting rank/total.

    Returns the player's no-punt baseline plus the punts that raise their value
    the most -- i.e. the categories worth building a punt team around for them.
    """
    base = _find(compute_values(players, pool=pool, punt=[]), player_id)
    if base is None:
        return {"player_id": player_id, "found": False, "options": []}

    options = []
    for cat in CATEGORY_KEYS:
        r = _find(compute_values(players, pool=pool, punt=[cat]), player_id)
        if r is None:
            continue
        options.append({
            "punt": cat,
            "rank": r["rank"],
            "total": r["total"],
            "rank_delta": base["rank"] - r["rank"],   # positive = moved up
            "total_delta": round(r["total"] - base["total"], 3),
        })

    options.sort(key=lambda o: o["rank_delta"], reverse=True)
    return {
        "player_id": player_id,
        "name": base["name"],
        "found": True,
        "baseline": {"rank": base["rank"], "total": base["total"]},
        "options": options[:top],
    }

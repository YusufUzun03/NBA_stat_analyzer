"""Rest-of-season projections.

A pragmatic, transparent heuristic (not an ML model): blend season-to-date
production with recent form. Recent form catches role changes (injuries,
rotations, breakouts) that season averages lag behind. The result is a
projected per-game line plus its z-value via the standard engine.

`project()` is pure (takes both stat lists in) so it can be unit-tested; the
service layer fetches season + last-N stats and calls it.
"""
from __future__ import annotations

from .zscore import compute_values

# Per-game component stats to blend. Percentages are derived from these.
_BLEND_KEYS = ["fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "min"]


def project(
    season_players: list[dict],
    recent_players: list[dict] | None = None,
    weight_recent: float = 0.35,
) -> list[dict]:
    """Blend season and recent per-game stats into projected player dicts.

    weight_recent in [0,1]: share given to recent form. Players with no recent
    data (e.g. early season) fall back to their season line.
    """
    recent_by_id = {p.get("id"): p for p in (recent_players or [])}
    w = max(0.0, min(1.0, weight_recent))
    projected = []
    for s in season_players:
        r = recent_by_id.get(s.get("id"))
        proj = dict(s)  # carry id/name/team/pos/gp
        for k in _BLEND_KEYS:
            sv = float(s.get(k) or 0)
            if r is not None and r.get(k) is not None:
                rv = float(r.get(k) or 0)
                proj[k] = round((1 - w) * sv + w * rv, 3)
            else:
                proj[k] = round(sv, 3)
        proj["fg_pct"] = round(proj["fgm"] / proj["fga"], 4) if proj["fga"] else 0.0
        proj["ft_pct"] = round(proj["ftm"] / proj["fta"], 4) if proj["fta"] else 0.0
        projected.append(proj)
    return projected


def project_and_rank(
    season_players: list[dict],
    recent_players: list[dict] | None,
    pool: int,
    punt: list[str] | None = None,
    weight_recent: float = 0.35,
) -> list[dict]:
    projected = project(season_players, recent_players, weight_recent)
    ranked = compute_values(projected, pool=pool, punt=punt)
    # Re-shape into a projections payload.
    out = []
    for r in ranked:
        out.append({
            "id": r["id"], "name": r["name"], "team": r["team"], "pos": r["pos"],
            "proj": r["stats"],
            "proj_total_z": r["total"],
            "z": r["z"],
            "rank": r["rank"],
        })
    return out

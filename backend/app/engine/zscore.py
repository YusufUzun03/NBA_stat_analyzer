"""9-category z-score engine.

Given a list of normalized player stat dicts, compute each player's per-category
z-score and total value, ranked against a configurable player *pool* (the set of
rosterable players used to define the league mean/std baseline).

Method (matches Hashtag Basketball / FantaZscores conventions):
  * Counting cats (3PM, PTS, REB, AST, STL, BLK): z = (x - mean) / std over the pool.
  * Turnovers: inverted (lower is better) -> z = (mean - x) / std.
  * Percentages (FG%, FT%): *volume-weighted impact*. A player's impact is
    (player_pct - pool_aggregate_pct) * attempts, then z over that impact
    distribution -- so efficient high-volume shooters are rewarded and low-volume
    outliers don't distort the category.

Two passes: rank everyone against the full qualified set, take the top `pool` as
the baseline, then recompute z-scores for everyone against that baseline.
"""
from __future__ import annotations

from typing import Iterable

from ..config import CATEGORIES, DEFAULT_POOL

# Players below this many minutes are treated as noise and excluded from ranking.
MIN_MINUTES = 12.0


def _mean_std(values: list[float]) -> tuple[float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 0.0
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n  # population variance
    return mean, var ** 0.5


def _pool_aggregate_pct(pool: list[dict], makes_key: str, att_key: str) -> float:
    total_att = sum(float(p.get(att_key) or 0) for p in pool)
    if total_att == 0:
        return 0.0
    total_makes = sum(float(p.get(makes_key) or 0) for p in pool)
    return total_makes / total_att


def _impact_values(players: list[dict], stat: str, vol: str, league_pct: float) -> list[float]:
    return [
        (float(p.get(stat) or 0) - league_pct) * float(p.get(vol) or 0)
        for p in players
    ]


def _makes_att_keys(vol: str) -> tuple[str, str]:
    # vol is 'fga' or 'fta'; makes are 'fgm' / 'ftm'
    return vol[:-1] + "m", vol


def _qualified(players: Iterable[dict]) -> list[dict]:
    return [p for p in players if float(p.get("min") or 0) >= MIN_MINUTES
            and float(p.get("gp") or 0) >= 1]


def _category_z(players: list[dict], baseline: list[dict]) -> dict[str, list[float]]:
    """Return {cat_key: [z per player in `players`]} using `baseline` for mean/std."""
    result: dict[str, list[float]] = {}
    for cat in CATEGORIES:
        key, stat, kind = cat["key"], cat["stat"], cat["kind"]
        if kind == "pct":
            makes_key, att_key = _makes_att_keys(cat["vol"])
            league_pct = _pool_aggregate_pct(baseline, makes_key, att_key)
            base_impacts = _impact_values(baseline, stat, cat["vol"], league_pct)
            mean, std = _mean_std(base_impacts)
            player_impacts = _impact_values(players, stat, cat["vol"], league_pct)
            result[key] = [
                (imp - mean) / std if std else 0.0 for imp in player_impacts
            ]
        else:
            base_vals = [float(p.get(stat) or 0) for p in baseline]
            mean, std = _mean_std(base_vals)
            sign = 1.0 if cat["higher_better"] else -1.0
            result[key] = [
                sign * (float(p.get(stat) or 0) - mean) / std if std else 0.0
                for p in players
            ]
    return result


def compute_values(
    players: list[dict],
    pool: int = DEFAULT_POOL,
    punt: list[str] | None = None,
) -> list[dict]:
    """Rank players by total 9-cat z-score.

    Returns a list of result dicts sorted by `total` desc, each with `rank`,
    raw `stats`, per-category `z` (punted cats omitted), and `total`.
    """
    punt = punt or []
    qualified = _qualified(players)
    if not qualified:
        return []

    # Pass 1: baseline = everyone qualified, to get a provisional ranking.
    z1 = _category_z(qualified, qualified)
    totals1 = _totals(z1, punt, len(qualified))
    order = sorted(range(len(qualified)), key=lambda i: totals1[i], reverse=True)
    pool_size = min(pool, len(qualified))
    baseline = [qualified[i] for i in order[:pool_size]]

    # Pass 2: recompute against the top-`pool` baseline.
    z2 = _category_z(qualified, baseline)
    totals2 = _totals(z2, punt, len(qualified))

    results = []
    for i, p in enumerate(qualified):
        z_full = {cat["key"]: round(z2[cat["key"]][i], 3) for cat in CATEGORIES}
        z_shown = {k: v for k, v in z_full.items() if k not in punt}
        results.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "team": p.get("team", ""),
            "pos": p.get("pos", ""),
            "gp": p.get("gp"),
            "min": p.get("min"),
            "stats": {
                "fg_pct": p.get("fg_pct"), "ft_pct": p.get("ft_pct"),
                "tpm": p.get("tpm"), "pts": p.get("pts"), "reb": p.get("reb"),
                "ast": p.get("ast"), "stl": p.get("stl"), "blk": p.get("blk"),
                "tov": p.get("tov"),
            },
            "z": z_shown,
            "total": round(totals2[i], 3),
        })

    results.sort(key=lambda r: r["total"], reverse=True)
    for rank, r in enumerate(results, start=1):
        r["rank"] = rank
    return results


def _totals(z: dict[str, list[float]], punt: list[str], n: int) -> list[float]:
    keys = [k for k in z if k not in punt]
    return [sum(z[k][i] for k in keys) for i in range(n)]

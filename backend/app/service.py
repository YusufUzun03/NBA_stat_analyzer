"""Service layer: fetch data, then call the engine.

Keeps FastAPI routes thin and isolates all basketball-reference access behind the
data client. Player ids are basketball-reference slugs (e.g. "jokicni01").
"""
from __future__ import annotations

from .config import DEFAULT_SEASON
from .data import nba_client
from .engine import projections, schedule, trade, zscore


def load_players(season: str = DEFAULT_SEASON) -> list[dict]:
    # Per-game rows already include team + position, so no enrichment needed.
    return nba_client.get_player_stats(season)


def rankings(season: str, pool: int, punt: list[str], limit: int, min_minutes: float = 12.0) -> dict:
    results = zscore.compute_values(load_players(season), pool=pool, punt=punt, min_minutes=min_minutes)
    return {"season": season, "pool": pool, "punt": punt, "min_minutes": min_minutes,
            "count": len(results), "players": results[:limit]}


def player_detail(season: str, player_id: str, pool: int, punt: list[str]) -> dict | None:
    results = zscore.compute_values(load_players(season), pool=pool, punt=punt)
    for r in results:
        if r["id"] == player_id:
            return r
    return None


def grade_trade(season: str, give: list[str], receive: list[str], pool: int, punt: list[str]) -> dict:
    return trade.analyze_trade(load_players(season), give, receive, pool=pool, punt=punt)


def projections_ros(season: str, pool: int, punt: list[str], limit: int) -> dict:
    # v1 projection baseline = season-to-date (basketball-reference has no cheap
    # league-wide "last N games" feed). The blend hook stays in projections.py
    # for a future recent-form upgrade.
    season_players = load_players(season)
    ranked = projections.project_and_rank(season_players, recent_players=None,
                                           pool=pool, punt=punt)
    return {"range": "ros", "season": season, "players": ranked[:limit]}


def schedule_week(season: str, anchor: str) -> dict:
    games = nba_client.get_schedule(season)
    return schedule.games_per_week(games, anchor)

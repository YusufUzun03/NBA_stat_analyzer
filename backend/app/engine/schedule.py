"""Schedule / matchup tool: games-per-week and streaming targets.

`games_per_week` is pure (takes the schedule + an anchor date). The week is the
Monday-Sunday block containing the anchor date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta


def week_bounds(anchor: str) -> tuple[date, date]:
    """Return (monday, sunday) for the week containing the YYYY-MM-DD `anchor`."""
    d = datetime.strptime(anchor[:10], "%Y-%m-%d").date()
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=6)


def _count_back_to_backs(days: list[date]) -> int:
    days = sorted(days)
    return sum(1 for i in range(1, len(days)) if (days[i] - days[i - 1]).days == 1)


def games_per_week(games: list[dict], anchor: str, top_n: int = 8) -> dict:
    """Tally each team's games in the anchor's week + rank streaming targets."""
    monday, sunday = week_bounds(anchor)
    per_team: dict[str, list[date]] = {}
    for g in games:
        try:
            gd = datetime.strptime(g["date"][:10], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            continue
        if monday <= gd <= sunday:
            for team in (g.get("home"), g.get("away")):
                if team:
                    per_team.setdefault(team, []).append(gd)

    teams = []
    for team, days in per_team.items():
        teams.append({
            "team": team,
            "games": len(days),
            "back_to_backs": _count_back_to_backs(days),
            "dates": [d.isoformat() for d in sorted(days)],
        })
    teams.sort(key=lambda t: (-t["games"], t["team"]))

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "teams": teams,
        "streaming_targets": [
            {"team": t["team"], "games": t["games"]} for t in teams[:top_n]
        ],
    }

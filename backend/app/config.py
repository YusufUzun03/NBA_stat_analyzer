"""Shared configuration and constants."""
from __future__ import annotations

import os
from pathlib import Path

# Repo root: backend/app/config.py -> parents[2] == project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# How long (seconds) a cached stats pull stays fresh before we re-fetch.
CACHE_TTL_SECONDS = int(os.getenv("NBA_CACHE_TTL", str(12 * 60 * 60)))  # 12h

# Default current season in nba_api format ("2025-26").
DEFAULT_SEASON = os.getenv("NBA_SEASON", "2025-26")

# Default player-pool size for z-score baselines (12 teams x 13 spots).
DEFAULT_POOL = 156

# The nine standard categories. `higher_better=False` means a higher raw value
# hurts you (turnovers). `kind` drives how the z-score is computed.
#   counting   -> straight z on the per-game average
#   pct        -> volume-weighted impact z (attempts come from `vol`)
CATEGORIES = [
    {"key": "fg",  "label": "FG%", "kind": "pct",      "stat": "fg_pct", "vol": "fga", "higher_better": True},
    {"key": "ft",  "label": "FT%", "kind": "pct",      "stat": "ft_pct", "vol": "fta", "higher_better": True},
    {"key": "tpm", "label": "3PM", "kind": "counting", "stat": "tpm",    "vol": None,  "higher_better": True},
    {"key": "pts", "label": "PTS", "kind": "counting", "stat": "pts",    "vol": None,  "higher_better": True},
    {"key": "reb", "label": "REB", "kind": "counting", "stat": "reb",    "vol": None,  "higher_better": True},
    {"key": "ast", "label": "AST", "kind": "counting", "stat": "ast",    "vol": None,  "higher_better": True},
    {"key": "stl", "label": "STL", "kind": "counting", "stat": "stl",    "vol": None,  "higher_better": True},
    {"key": "blk", "label": "BLK", "kind": "counting", "stat": "blk",    "vol": None,  "higher_better": True},
    {"key": "tov", "label": "TOV", "kind": "counting", "stat": "tov",    "vol": None,  "higher_better": False},
]

CATEGORY_KEYS = [c["key"] for c in CATEGORIES]
CATEGORY_BY_KEY = {c["key"]: c for c in CATEGORIES}


def parse_punt(punt: str | list[str] | None) -> list[str]:
    """Normalize a punt spec (csv string or list) to a list of valid category keys."""
    if not punt:
        return []
    if isinstance(punt, str):
        items = [p.strip().lower() for p in punt.split(",")]
    else:
        items = [str(p).strip().lower() for p in punt]
    return [p for p in items if p in CATEGORY_BY_KEY]

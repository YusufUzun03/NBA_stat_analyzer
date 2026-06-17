"""Generate frontend/data/players-{season}.json.

Runs the 9-cat z-score engine over the live per-game stats and writes the ranked
snapshot the hosted (static) frontend reads for the value board, positional
ranks, streamers, projections and leaders. Single HTTP request to
basketball-reference, so this is fast.

Run from the backend/ directory:
    python scripts/gen_players.py
"""
from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON, DEFAULT_POOL
from app.data.nba_client import get_player_stats
from app.engine.zscore import compute_values, MIN_MINUTES

SEASON = DEFAULT_SEASON
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"players-{SEASON}.json"


def main() -> None:
    print(f"Fetching per-game stats for {SEASON}…")
    players = get_player_stats(SEASON)
    # Include EVERY player who appeared (min_minutes=0); z-scores are still
    # anchored to the top-`pool` baseline, so the rankings are unchanged — there
    # are just more low-minute names available for search and the MPG filter.
    ranked = compute_values(players, pool=DEFAULT_POOL, punt=[], min_minutes=0)

    # Never clobber a good snapshot with an empty one (e.g. preseason before any
    # games are played, or a transient scrape failure).
    if not ranked:
        print("No qualified players returned — leaving the existing snapshot untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({
            "season": SEASON,
            "pool": DEFAULT_POOL,
            "punt": [],
            "min_minutes": 0,
            "count": len(ranked),
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "basketball-reference.com",
            "players": ranked,
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {len(ranked)} players ({size_kb:.0f} KB) → {OUT}")


if __name__ == "__main__":
    main()

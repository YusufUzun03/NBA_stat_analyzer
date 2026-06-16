"""Generate frontend/data/schedule-{season}.json by scraping basketball-reference.

Scrapes the monthly schedule pages (throttled) into one static snapshot the
hosted frontend reads for the Schedule, My Team weekly projection and Best
Streamers tools. Takes ~25s the first time (several throttled requests).

Run from the backend/ directory:
    python scripts/gen_schedule.py
"""
from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON
from app.data.nba_client import get_schedule

SEASON = DEFAULT_SEASON
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"schedule-{SEASON}.json"


def main() -> None:
    print(f"Fetching schedule for {SEASON}…")
    games = get_schedule(SEASON)

    if not games:
        print("No games returned — leaving the existing schedule snapshot untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({
            "season": SEASON,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "basketball-reference.com",
            "games": games,
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {len(games)} games ({size_kb:.0f} KB) → {OUT}")


if __name__ == "__main__":
    main()

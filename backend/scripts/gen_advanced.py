"""Generate frontend/data/advanced-{season}.json.

Run from the backend/ directory:
    python scripts/gen_advanced.py

Single HTTP request to basketball-reference — instant.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON
from app.data.nba_client import get_advanced_stats

SEASON = DEFAULT_SEASON
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"advanced-{SEASON}.json"


def main() -> None:
    print(f"Fetching advanced stats for {SEASON}…")
    rows = get_advanced_stats(SEASON)
    players = {r["id"]: {k: v for k, v in r.items() if k != "id"} for r in rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"season": SEASON, "players": players}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"Wrote {len(players)} players ({size_kb:.0f} KB) → {OUT}")


if __name__ == "__main__":
    main()

"""Generate frontend/data/career-{season}.json by scraping basketball-reference.

Run from the backend/ directory:
    python scripts/gen_career.py

On first run: fetches ~444 player pages (2-3 s each = ~15 min).
Subsequent runs: instant (all data served from the disk cache).
Partial runs can be resumed: existing output is loaded and players
already present are skipped.
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

# Force UTF-8 stdout so player names with non-ASCII chars don't crash on
# Windows terminals that default to cp1252/cp1254.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Allow `from app.data import nba_client` when running as a script.
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON, CACHE_DIR
from app.data import nba_client

SEASON = DEFAULT_SEASON
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"career-{SEASON}.json"
THROTTLE = 3.5   # seconds between non-cached HTTP requests


def _is_cached(player_id: str) -> bool:
    p = CACHE_DIR / f"career_{player_id}.json"
    return p.exists()


def main() -> None:
    print(f"Season: {SEASON}")
    print(f"Output: {OUT}")

    # Load existing output so we can resume.
    existing: dict[str, list] = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8")).get("players", {})
            print(f"Resuming — {len(existing)} players already in output.")
        except (json.JSONDecodeError, OSError):
            pass

    players = nba_client.get_player_stats(SEASON)
    print(f"Roster: {len(players)} players")

    career_data: dict[str, list] = dict(existing)
    total = len(players)

    for i, player in enumerate(players):
        pid = player.get("id", "")
        name = player.get("name", "?")
        if not pid:
            continue
        if pid in career_data:
            continue   # already have it — skip

        cached = _is_cached(pid)
        tag = "(cached)" if cached else "        "
        print(f"[{i+1:>3}/{total}] {name:<26} {pid} {tag}", end=" ", flush=True)

        try:
            career = nba_client.get_career_stats(pid)
            career_data[pid] = career
            print(f"→ {len(career)} seasons")
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            print(f"ERROR {status or ''}: {exc}")
            career_data[pid] = []
            # On 429 back off extra long before continuing
            if status == 429:
                print("  Rate limited — sleeping 60s …", flush=True)
                time.sleep(60)

        if not cached:
            time.sleep(THROTTLE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"season": SEASON, "players": career_data},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"\nWrote {len(career_data)} players to {OUT}")
    size_kb = OUT.stat().st_size / 1024
    print(f"File size: {size_kb:.0f} KB")


if __name__ == "__main__":
    main()

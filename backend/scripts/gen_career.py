"""Generate frontend/data/career-{season}.json by scraping basketball-reference.

Run from the backend/ directory:
    python scripts/gen_career.py

On first run: fetches player pages at ~4s each.
If rate-limited (429): saves progress to output file and exits cleanly.
Re-run later — already-cached players are instant, progress resumes.
Full run typically needs 2-3 sessions spaced an hour apart.
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON, CACHE_DIR
from app.data import nba_client

SEASON = DEFAULT_SEASON
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"career-{SEASON}.json"
THROTTLE = 4.0   # seconds between live HTTP requests


def _is_cached(player_id: str) -> bool:
    p = CACHE_DIR / f"career_{player_id}.json"
    if not p.exists():
        return False
    try:
        blob = json.loads(p.read_text(encoding="utf-8"))
        return bool(blob.get("data"))   # only count non-empty cache hits
    except Exception:
        return False


def _flush(career_data: dict, total_players: int) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Only write players that have actual data (>0 seasons)
    good = {k: v for k, v in career_data.items() if v}
    OUT.write_text(
        json.dumps({"season": SEASON, "players": good},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"\nSaved {len(good)}/{total_players} players ({size_kb:.0f} KB) → {OUT}")


def main() -> None:
    print(f"Season: {SEASON}")
    print(f"Output: {OUT}")

    # Load existing output so we can resume from last good flush.
    # Only keep players that have actual season data (ignore empty [] entries
    # from failed/rate-limited previous runs so they get retried).
    existing: dict[str, list] = {}
    if OUT.exists():
        try:
            raw = json.loads(OUT.read_text(encoding="utf-8")).get("players", {})
            existing = {k: v for k, v in raw.items() if v}
            print(f"Resuming — {len(existing)} players already in output.")
        except (json.JSONDecodeError, OSError):
            pass

    players = nba_client.get_player_stats(SEASON)
    total = len(players)
    print(f"Roster: {total} players")

    career_data: dict[str, list] = dict(existing)
    fetched = 0

    for i, player in enumerate(players):
        pid = player.get("id", "")
        name = player.get("name", "?")
        if not pid:
            continue
        if pid in career_data:
            continue   # already done in a previous run

        cached = _is_cached(pid)
        tag = "(cached)" if cached else "        "
        print(f"[{i+1:>3}/{total}] {name:<26} {pid} {tag}", end=" ", flush=True)

        try:
            career = nba_client.get_career_stats(pid)
            career_data[pid] = career
            fetched += 1
            print(f"→ {len(career)} seasons")
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429:
                print(f"RATE LIMITED — saving progress and exiting.", flush=True)
                _flush(career_data, total)
                print("Re-run in ~1 hour to continue.")
                return
            print(f"ERROR {status or ''}: {exc}")
            # Non-429 errors (404, network): record as empty and continue
            career_data[pid] = []

        if not cached:
            time.sleep(THROTTLE)

    _flush(career_data, total)
    print("Done!")


if __name__ == "__main__":
    main()

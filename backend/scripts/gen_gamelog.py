"""Generate frontend/data/gamelog-{season}.json by scraping basketball-reference.

Run from the backend/ directory:
    python scripts/gen_gamelog.py            # all rosterable players
    python scripts/gen_gamelog.py --top 60   # only the top-N by minutes (faster)

This precomputes per-game logs into ONE static snapshot so the hosted frontend
can power "Recent Form" and the Last-5/7/15/30 tables without ever hitting the
live API or scraping at runtime — the page just loads a static JSON file.

On first run: fetches each player's gamelog page at ~3.5s each.
If rate-limited (429): saves progress to the output file and exits cleanly.
Re-run later — already-cached players are instant, progress resumes.

Each game is trimmed to the fields the frontend's Recent Form tab uses, keeping
the snapshot small. Players with no games this season are skipped entirely.
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
OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / f"gamelog-{SEASON}.json"
THROTTLE = 3.5   # seconds between live HTTP requests

# Only the fields the Recent Form tab renders — keeps the snapshot lean.
KEEP = ("date", "opp", "result", "pts", "reb", "ast", "stl", "blk",
        "tov", "tpm", "fg_pct", "ft_pct")


def _trim(games: list[dict]) -> list[dict]:
    return [{k: g.get(k) for k in KEEP} for g in games]


def _is_cached(player_id: str) -> bool:
    p = CACHE_DIR / f"gamelog_{player_id}_{SEASON}.json"
    if not p.exists():
        return False
    try:
        blob = json.loads(p.read_text(encoding="utf-8"))
        return "data" in blob
    except Exception:
        return False


def _flush(data: dict, total: int) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    good = {k: v for k, v in data.items() if v}
    OUT.write_text(
        json.dumps({"season": SEASON, "players": good},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = OUT.stat().st_size / 1024
    print(f"\nSaved {len(good)}/{total} players ({size_kb:.0f} KB) → {OUT}")


def main() -> None:
    top_n = None
    if "--top" in sys.argv:
        try:
            top_n = int(sys.argv[sys.argv.index("--top") + 1])
        except (IndexError, ValueError):
            print("Usage: python scripts/gen_gamelog.py [--top N]")
            return

    print(f"Season: {SEASON}")
    print(f"Output: {OUT}")

    # Resume from last good flush; drop empty entries so they get retried.
    existing: dict[str, list] = {}
    if OUT.exists():
        try:
            raw = json.loads(OUT.read_text(encoding="utf-8")).get("players", {})
            existing = {k: v for k, v in raw.items() if v}
            print(f"Resuming — {len(existing)} players already in output.")
        except (json.JSONDecodeError, OSError):
            pass

    players = nba_client.get_player_stats(SEASON)
    # Prioritise high-minute players (most useful for streaming/recent-form).
    players.sort(key=lambda p: p.get("min", 0) or 0, reverse=True)
    if top_n:
        players = players[:top_n]
    total = len(players)
    print(f"Players to process: {total}")

    data: dict[str, list] = dict(existing)
    fetched = 0

    for i, player in enumerate(players):
        pid = player.get("id", "")
        name = player.get("name", "?")
        if not pid or pid in data:
            continue

        cached = _is_cached(pid)
        tag = "(cached)" if cached else "        "
        print(f"[{i+1:>3}/{total}] {name:<26} {pid} {tag}", end=" ", flush=True)

        try:
            games = nba_client.get_game_log(pid, SEASON)
            data[pid] = _trim(games)
            fetched += 1
            print(f"→ {len(games)} games")
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429:
                print("RATE LIMITED — saving progress and exiting.", flush=True)
                _flush(data, total)
                print("Re-run in ~1 hour to continue.")
                return
            print(f"ERROR {status or ''}: {exc}")
            data[pid] = []

        if not cached:
            time.sleep(THROTTLE)

    _flush(data, total)
    print("Done!")


if __name__ == "__main__":
    main()

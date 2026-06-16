"""Generate per-player game logs under frontend/data/gamelog/{season}/{id}.json.

Run from the backend/ directory:
    python scripts/gen_gamelog.py             # all rosterable players
    python scripts/gen_gamelog.py --top 60    # only the top-N by minutes (faster)
    python scripts/gen_gamelog.py --resume     # skip players already written (crash recovery)

One small file per player (~7 KB) instead of a single 4 MB blob, so the hosted
frontend downloads only the log for the player whose Recent Form tab is opened.

On first run: fetches each player's gamelog page at ~3.5s each.
If rate-limited (429): the files written so far persist; re-run with --resume.

Each game is trimmed to the fields the frontend's Recent Form tab uses.
Players with no games this season are skipped (no file -> frontend treats as
"no log", a clean 404).
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON
from app.data import nba_client

SEASON = DEFAULT_SEASON
OUT_DIR = Path(__file__).parent.parent.parent / "frontend" / "data" / "gamelog" / SEASON
THROTTLE = 3.5   # seconds between live HTTP requests

# Only the fields the Recent Form tab renders — keeps each file lean.
KEEP = ("date", "opp", "result", "pts", "reb", "ast", "stl", "blk",
        "tov", "tpm", "fg_pct", "ft_pct")


def _trim(games: list[dict]) -> list[dict]:
    return [{k: g.get(k) for k in KEEP} for g in games]


def _write_player(pid: str, games: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{pid}.json").write_text(
        json.dumps(_trim(games), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    top_n = None
    if "--top" in sys.argv:
        try:
            top_n = int(sys.argv[sys.argv.index("--top") + 1])
        except (IndexError, ValueError):
            print("Usage: python scripts/gen_gamelog.py [--top N] [--resume]")
            return
    resume = "--resume" in sys.argv

    print(f"Season: {SEASON}")
    print(f"Output dir: {OUT_DIR}")

    done = {f.stem for f in OUT_DIR.glob("*.json")} if (resume and OUT_DIR.exists()) else set()
    if done:
        print(f"Resuming — {len(done)} players already written, skipping them.")

    players = nba_client.get_player_stats(SEASON)
    # Prioritise high-minute players (most useful for streaming / recent-form).
    players.sort(key=lambda p: p.get("min", 0) or 0, reverse=True)
    if top_n:
        players = players[:top_n]
    total = len(players)
    print(f"Players to process: {total}")

    written = 0
    for i, player in enumerate(players):
        pid = player.get("id", "")
        name = player.get("name", "?")
        if not pid or pid in done:
            continue
        print(f"[{i+1:>3}/{total}] {name:<26} {pid}", end=" ", flush=True)
        try:
            games = nba_client.get_game_log(pid, SEASON)
            if games:
                _write_player(pid, games)
                written += 1
            print(f"→ {len(games)} games")
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 429:
                print("RATE LIMITED — files so far are saved. Re-run with --resume.", flush=True)
                return
            print(f"ERROR {status or ''}: {exc}")
        time.sleep(THROTTLE)

    print(f"\nDone! Wrote {written} player files → {OUT_DIR}")


if __name__ == "__main__":
    main()

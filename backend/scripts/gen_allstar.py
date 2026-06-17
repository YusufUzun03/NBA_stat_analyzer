"""Generate frontend/data/allstar.json — All-Star rosters per season.

The All-Star format changes over the years (East/West, captain-drafted
"Team LeBron/Giannis", the 2025 four-team mini-tournament), but each roster
is its own table on basketball-reference whose id is the squad name — so this
just reads every roster table on the season's All-Star page. Seasons with no
game are skipped. Runs in the weekly refresh.

Run from the backend/ directory:
    python scripts/gen_allstar.py
"""
from __future__ import annotations

import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from bs4 import BeautifulSoup
from app.config import current_season
from app.data.nba_client import _get_html

OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / "allstar.json"


def scrape_season(year: int) -> list[dict]:
    soup = BeautifulSoup(_get_html(f"https://www.basketball-reference.com/allstar/NBA_{year}.html"), "lxml")
    rosters = []
    for t in soup.find_all("table"):
        tid = t.get("id")
        if not tid or tid == "line_score":
            continue
        players = []
        for a in t.select('tbody a[href*="/players/"]'):
            name = a.get_text(strip=True)
            if name and name not in players:
                players.append(name)
        if players:
            rosters.append({"name": tid, "players": players})
    return rosters


def main() -> None:
    end = int(current_season().split("-")[0]) + 1
    data = {}
    for year in range(2001, end + 1):
        season = f"{year - 1}-{year % 100:02d}"
        try:
            rosters = scrape_season(year)
            if rosters:
                data[season] = rosters
                print(f"{season}: {', '.join(r['name'] for r in rosters)}")
        except Exception as exc:
            print(f"{season}: skipped — {exc}")
        time.sleep(2.5)

    if not data:
        print("No All-Star rosters scraped — leaving existing file untouched.")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "basketball-reference.com",
        "seasons": data,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(data)} seasons → {OUT} ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()

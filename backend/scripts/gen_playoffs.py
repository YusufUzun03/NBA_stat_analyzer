"""Generate frontend/data/playoffs.json — playoff series (bracket) per season.

Parses each season's playoff page on basketball-reference for the series
summaries (round, winner over loser, series score) so the frontend can draw a
bracket. Covers every season the app carries (2000-01 onward). Runs weekly.

Run from the backend/ directory:
    python scripts/gen_playoffs.py
"""
from __future__ import annotations

import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from bs4 import BeautifulSoup
from app.config import current_season
from app.data.nba_client import _get_html

OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / "playoffs.json"
_SERIES = re.compile(r"^(.+?)\s+over\s+(.+?)\s+\((\d+-\d+)\)")


def _stage(round_name: str) -> str:
    r = round_name.lower()
    if "first round" in r:
        return "First Round"
    if "semifinal" in r:
        return "Conf Semifinals"
    if "conference finals" in r:
        return "Conf Finals"
    if r == "finals":
        return "Finals"
    return round_name


def _conf(round_name: str) -> str:
    if "eastern" in round_name.lower():
        return "East"
    if "western" in round_name.lower():
        return "West"
    return ""


def _abbr(a) -> str:
    if a and a.get("href"):
        m = re.search(r"/teams/([A-Z]{3})/", a["href"])
        if m:
            return m.group(1)
    return ""


def scrape_season(year: int) -> list[dict]:
    soup = BeautifulSoup(_get_html(f"https://www.basketball-reference.com/playoffs/NBA_{year}.html"), "lxml")
    t = soup.find("table", id="all_playoffs")
    if not t:
        return []
    out = []
    for tr in t.find_all("tr"):
        if tr.get("class"):                       # skip toggleable game-log + thead rows
            continue
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        round_name = cells[0].get_text(" ", strip=True)
        m = _SERIES.match(cells[1].get_text(" ", strip=True))
        if not round_name or not m:
            continue
        links = cells[1].find_all("a")
        out.append({
            "stage": _stage(round_name),
            "conf": _conf(round_name),
            "winner": m.group(1), "winner_abbr": _abbr(links[0] if links else None),
            "loser": m.group(2), "loser_abbr": _abbr(links[1] if len(links) > 1 else None),
            "score": m.group(3),
        })
    return out


def main() -> None:
    end = int(current_season().split("-")[0]) + 1
    data = {}
    for year in range(2001, end + 1):
        season = f"{year - 1}-{year % 100:02d}"
        try:
            series = scrape_season(year)
            if series:
                data[season] = series
                print(f"{season}: {len(series)} series")
        except Exception as exc:
            print(f"{season}: failed — {exc}")
        time.sleep(2.5)

    if not data:
        print("No playoffs scraped — leaving existing file untouched.")
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

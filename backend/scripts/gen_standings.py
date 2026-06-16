"""Generate frontend/data/standings.json — East/West standings per season.

One conference-standings table per season from basketball-reference, for every
season the app carries (2000-01 onward). Slow-changing once a season ends; runs
in the weekly refresh.

Run from the backend/ directory:
    python scripts/gen_standings.py
"""
from __future__ import annotations

import io
import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from bs4 import BeautifulSoup, Comment
from app.config import current_season
from app.data.nba_client import _get_html


def _soup_all(url: str) -> BeautifulSoup:
    """Parse a BR page, also surfacing tables hidden inside HTML comments
    (older seasons keep the conference standings commented out)."""
    s = BeautifulSoup(_get_html(url), "lxml")
    for c in s.find_all(string=lambda t: isinstance(t, Comment)):
        if "<table" in c:
            try: s.append(BeautifulSoup(c, "lxml"))
            except Exception: pass
    return s

OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / "standings.json"


def _abbr(cell) -> str:
    a = cell.find("a") if cell else None
    if a and a.get("href"):
        m = re.search(r"/teams/([A-Z]{3})/", a["href"])
        if m:
            return m.group(1)
    return ""


def scrape_conf(soup, table_id) -> list[dict]:
    t = soup.find("table", id=table_id)
    if not t:
        return []
    out = []
    for tr in t.find("tbody").find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue
        cells = {td.get("data-stat"): td for td in tr.find_all(["th", "td"])}
        name_cell = cells.get("team_name")
        if not name_cell:
            continue
        name = name_cell.get_text(" ", strip=True).replace("\xa0", " ")
        seed = ""
        m = re.search(r"\((\d+)\)\s*$", name)        # trailing "(seed)"
        if m:
            seed = m.group(1); name = name[:m.start()].strip()
        name = name.rstrip("*").strip()              # playoff asterisk
        txt = lambda k: cells[k].get_text(strip=True) if k in cells else ""
        out.append({
            "team": name, "abbr": _abbr(name_cell), "seed": seed,
            "w": txt("wins"), "l": txt("losses"), "pct": txt("win_loss_pct"), "gb": txt("gb"),
        })
    return out


def main() -> None:
    end = int(current_season().split("-")[0]) + 1   # season end year of the current season
    data = {}
    for year in range(2001, end + 1):
        season = f"{year - 1}-{year % 100:02d}"
        try:
            soup = _soup_all(f"https://www.basketball-reference.com/leagues/NBA_{year}_standings.html")
            # modern seasons have flat conference tables; older ones only the
            # division-grouped tables (same columns) — fall back to those.
            east = scrape_conf(soup, "confs_standings_E") or scrape_conf(soup, "divs_standings_E")
            west = scrape_conf(soup, "confs_standings_W") or scrape_conf(soup, "divs_standings_W")
            # division tables are grouped by division, not conference rank — sort
            # each conference by win% and renumber the seeds so the order is right.
            for conf in (east, west):
                conf.sort(key=lambda r: float(r["pct"] or 0), reverse=True)
                for i, r in enumerate(conf, 1):
                    r["seed"] = str(i)
            if east or west:
                data[season] = {"East": east, "West": west}
                print(f"{season}: E{len(east)} W{len(west)}")
        except Exception as exc:
            print(f"{season}: failed — {exc}")
        time.sleep(2.5)

    if not data:
        print("No standings scraped — leaving existing file untouched.")
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

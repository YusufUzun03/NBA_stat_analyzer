"""Generate frontend/data/history.json — NBA champions + award winners by season.

Scrapes basketball-reference's playoffs index (champions, Finals MVP, playoff
stat leaders) and the award pages (MVP, DPOY, ROY, 6MOY, MIP). This is
slow-changing history, so it only needs regenerating occasionally (it runs in
the weekly refresh).

Run from the backend/ directory:
    python scripts/gen_history.py
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
from app.data.nba_client import _get_html

OUT = Path(__file__).parent.parent.parent / "frontend" / "data" / "history.json"
AWARDS = [
    ("mvp", "Most Valuable Player"),
    ("dpoy", "Defensive Player of the Year"),
    ("roy", "Rookie of the Year"),
    ("smoy", "Sixth Man of the Year"),
    ("mip", "Most Improved Player"),
]


def _year_to_season(y: str) -> str:
    """'2025' -> '2024-25' (BR's playoffs index uses the season's end year)."""
    try:
        n = int(y)
        return f"{n - 1}-{n % 100:02d}"
    except ValueError:
        return y


def _abbr_from_cell(cell) -> str:
    a = cell.find("a") if cell else None
    if a and a.get("href"):
        m = re.search(r"/teams/([A-Z]{3})/", a["href"])
        if m:
            return m.group(1)
    return ""


def scrape_champions() -> list[dict]:
    soup = BeautifulSoup(_get_html("https://www.basketball-reference.com/playoffs/"), "lxml")
    t = soup.find("table", id="champions_index")
    out = []
    for tr in t.find("tbody").find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue
        cells = {td.get("data-stat"): td for td in tr.find_all(["th", "td"])}
        txt = lambda k: cells[k].get_text(" ", strip=True) if k in cells else ""
        year = txt("year_id")
        champ = txt("champion")
        if not year or not champ:
            continue
        out.append({
            "season": _year_to_season(year),
            "champion": champ,
            "champion_abbr": _abbr_from_cell(cells.get("champion")),
            "runner_up": txt("runnerup"),
            "runner_up_abbr": _abbr_from_cell(cells.get("runnerup")),
            "finals_mvp": txt("mvp_finals"),
            "pts_leader": txt("pts_leader_name"),
            "reb_leader": txt("trb_leader_name"),
            "ast_leader": txt("ast_leader_name"),
        })
    return out


def scrape_award(slug: str) -> list[dict]:
    soup = BeautifulSoup(_get_html(f"https://www.basketball-reference.com/awards/{slug}.html"), "lxml")
    t = soup.find("table")
    out = []
    for tr in t.find("tbody").find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue
        cells = {td.get("data-stat"): td for td in tr.find_all(["th", "td"])}
        txt = lambda k: cells[k].get_text(" ", strip=True) if k in cells else ""
        season, player = txt("season"), txt("player")
        if not season or not player:
            continue
        out.append({"season": season, "player": player, "team": txt("team_id")})
    return out


def main() -> None:
    print("Scraping champions…")
    champions = scrape_champions()
    print(f"  {len(champions)} seasons")
    awards = {}
    labels = {}
    for slug, label in AWARDS:
        time.sleep(3)
        print(f"Scraping {slug}…")
        try:
            awards[slug] = scrape_award(slug)
            labels[slug] = label
            print(f"  {len(awards[slug])} winners")
        except Exception as exc:
            print(f"  failed: {exc}")

    if not champions and not awards:
        print("Nothing scraped — leaving existing history untouched.")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "basketball-reference.com",
        "champions": champions,
        "award_labels": labels,
        "awards": awards,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()

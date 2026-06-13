"""Data client for basketball-reference.com.

stats.nba.com is geo-fenced to the US and unreachable from many regions (it
simply times out), so season per-game stats and the schedule are sourced from
basketball-reference.com, which is globally accessible. All network pulls are
cached to ``cache/<key>.json`` and reused until ``CACHE_TTL_SECONDS`` elapses.

Be polite to BR: it asks for well under ~20 requests/minute. We make at most a
handful of requests per cache refresh and throttle between schedule pages.
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable

import requests
from bs4 import BeautifulSoup

from ..config import CACHE_DIR, CACHE_TTL_SECONDS, DEFAULT_SEASON

BREF_BASE = "https://www.basketball-reference.com"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
# Months a regular season can span (BR 404s on months with no games; we skip those).
_SEASON_MONTHS = ["october", "november", "december", "january",
                  "february", "march", "april"]
_THROTTLE_SECONDS = 3.5


# --- disk cache -----------------------------------------------------------

def _cache_path(key: str):
    return CACHE_DIR / f"{key.replace('/', '_').replace(' ', '_')}.json"


def cached(key: str, fetch: Callable[[], Any], ttl: int = CACHE_TTL_SECONDS) -> Any:
    path = _cache_path(key)
    if path.exists():
        try:
            blob = json.loads(path.read_text(encoding="utf-8"))
            if time.time() - blob.get("_ts", 0) < ttl:
                return blob["data"]
        except (json.JSONDecodeError, KeyError, OSError):
            pass
    data = fetch()
    try:
        path.write_text(json.dumps({"_ts": time.time(), "data": data},
                                   ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return data


# --- http -----------------------------------------------------------------

def _get_html(url: str) -> str:
    resp = requests.get(url, headers=_HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.text


def _bref_year(season: str) -> int:
    """'2025-26' -> 2026 (basketball-reference indexes seasons by their end year)."""
    return int(season[:4]) + 1


def _num(text: str | None) -> float:
    if text in (None, "", "-"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


# --- player per-game stats ------------------------------------------------

# basketball-reference data-stat -> our normalized key
_STAT_MAP = {
    "pos": "pos", "games": "gp", "mp_per_g": "min",
    "fg_per_g": "fgm", "fga_per_g": "fga", "fg_pct": "fg_pct",
    "fg3_per_g": "tpm", "ft_per_g": "ftm", "fta_per_g": "fta", "ft_pct": "ft_pct",
    "trb_per_g": "reb", "ast_per_g": "ast", "stl_per_g": "stl",
    "blk_per_g": "blk", "tov_per_g": "tov", "pts_per_g": "pts",
}
_NUMERIC_KEYS = {"gp", "min", "fgm", "fga", "fg_pct", "tpm", "ftm", "fta",
                 "ft_pct", "reb", "ast", "stl", "blk", "tov", "pts"}


def _parse_per_game(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="per_game_stats")
    if table is None:
        return []
    players: dict[str, dict] = {}  # keyed by player id; first row (season total) wins
    body = table.find("tbody")
    for tr in body.find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue
        name_cell = tr.find(attrs={"data-stat": "name_display"}) or \
            tr.find(attrs={"data-stat": "player"})
        if name_cell is None:
            continue
        pid = name_cell.get("data-append-csv") or _slug_from_link(name_cell)
        if not pid:
            continue
        row: dict[str, Any] = {"id": pid, "name": name_cell.get_text(strip=True)}
        team_cell = tr.find("td", {"data-stat": "team_name_abbr"}) or \
            tr.find("td", {"data-stat": "team_id"})
        row["team"] = team_cell.get_text(strip=True) if team_cell else ""
        for data_stat, key in _STAT_MAP.items():
            cell = tr.find("td", {"data-stat": data_stat})
            txt = cell.get_text(strip=True) if cell else ""
            row[key] = _num(txt) if key in _NUMERIC_KEYS else txt
        # derive makes/attempts already present; keep first row per player
        # (BR lists a combined 2TM/3TM total row before the per-team splits).
        if pid not in players:
            players[pid] = row
    return list(players.values())


def _slug_from_link(cell) -> str:
    """Extract a bbref player id from /players/x/slug.html (e.g. 'jokicni01')."""
    link = cell.find("a")
    if link and "/players/" in link.get("href", ""):
        return link["href"].rsplit("/", 1)[-1].replace(".html", "")
    return ""


def _fetch_player_stats(season: str) -> list[dict]:
    year = _bref_year(season)
    html = _get_html(f"{BREF_BASE}/leagues/NBA_{year}_per_game.html")
    return _parse_per_game(html)


# --- schedule -------------------------------------------------------------

def _parse_schedule(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="schedule")
    if table is None:
        return []
    games = []
    body = table.find("tbody")
    for tr in body.find_all("tr"):
        if "thead" in (tr.get("class") or []):
            continue
        date_cell = tr.find("th", {"data-stat": "date_game"})
        if date_cell is None:
            continue
        # Row text is like "Thu, Jan 1, 2026"; fall back to the csk YYYYMMDD prefix.
        date = _date_from_text(date_cell.get_text(strip=True))
        if not date:
            csk = (date_cell.get("csk") or "")[:8]
            date = f"{csk[:4]}-{csk[4:6]}-{csk[6:8]}" if len(csk) == 8 else ""
        visitor = _team_abbr(tr.find("td", {"data-stat": "visitor_team_name"}))
        home = _team_abbr(tr.find("td", {"data-stat": "home_team_name"}))
        if date and visitor and home:
            games.append({"date": date, "away": visitor, "home": home})
    return games


def _team_abbr(cell) -> str:
    """Pull the 3-letter abbreviation from the team link href (/teams/DEN/2026.html)."""
    if cell is None:
        return ""
    link = cell.find("a")
    if link and link.get("href", "").startswith("/teams/"):
        return link["href"].split("/")[2]
    return cell.get_text(strip=True)


def _date_from_text(text: str) -> str:
    from datetime import datetime
    for fmt in ("%a, %b %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _fetch_schedule(season: str) -> list[dict]:
    year = _bref_year(season)
    games: list[dict] = []
    for i, month in enumerate(_SEASON_MONTHS):
        url = f"{BREF_BASE}/leagues/NBA_{year}_games-{month}.html"
        try:
            if i:
                time.sleep(_THROTTLE_SECONDS)  # be polite between pages
            games.extend(_parse_schedule(_get_html(url)))
        except requests.HTTPError:
            continue  # month with no games -> 404, skip
    return games


# --- career per-game stats (individual player page) -----------------------

def _parse_player_career(html: str) -> list[dict]:
    """Parse per-season per-game stats from a basketball-reference player page."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="per_game")
    if table is None:
        return []

    seasons: dict[str, dict] = {}
    body = table.find("tbody")
    if not body:
        return []

    for tr in body.find_all("tr"):
        if "thead" in (tr.get("class") or []) or "partial_table" in (tr.get("class") or []):
            continue

        def cell_txt(stat: str) -> str:
            td = tr.find(attrs={"data-stat": stat})
            return td.get_text(strip=True) if td else ""

        def flt(stat: str) -> float | None:
            v = cell_txt(stat)
            if not v:
                return None
            try:
                return float(v)
            except ValueError:
                return None

        season = cell_txt("season")
        if not season or "Career" in season:
            continue

        # Keep first row per season — BR lists the multi-team aggregate before
        # the per-team splits, so the first row is always the season total.
        if season in seasons:
            continue

        seasons[season] = {
            "season": season,
            "age":    flt("age"),
            "team":   cell_txt("team_id"),
            "gp":     flt("g"),
            "min":    flt("mp_per_g"),
            "pts":    flt("pts_per_g"),
            "reb":    flt("trb_per_g"),
            "ast":    flt("ast_per_g"),
            "stl":    flt("stl_per_g"),
            "blk":    flt("blk_per_g"),
            "tpm":    flt("fg3_per_g"),
            "fg_pct": flt("fg_pct"),
            "ft_pct": flt("ft_pct"),
            "tov":    flt("tov_per_g"),
        }

    return sorted(seasons.values(), key=lambda r: r["season"])


def _fetch_career_stats(player_id: str) -> list[dict]:
    first_letter = player_id[0]
    url = f"{BREF_BASE}/players/{first_letter}/{player_id}.html"
    try:
        html = _get_html(url)
        return _parse_player_career(html)
    except Exception:
        return []


# --- public API -----------------------------------------------------------

def get_player_stats(season: str = DEFAULT_SEASON) -> list[dict]:
    return cached(f"players_{season}", lambda: _fetch_player_stats(season))


def get_schedule(season: str = DEFAULT_SEASON) -> list[dict]:
    return cached(f"schedule_{season}", lambda: _fetch_schedule(season), ttl=CACHE_TTL_SECONDS)


def get_career_stats(player_id: str) -> list[dict]:
    """Per-season career per-game stats (cached 7 days — historical data rarely changes)."""
    ttl = 7 * 24 * 3600
    return cached(f"career_{player_id}", lambda: _fetch_career_stats(player_id), ttl=ttl)

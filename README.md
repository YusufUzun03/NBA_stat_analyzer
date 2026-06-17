# 🏀 BoxScore — NBA Fantasy Stat Analyzer

**▶ Live app: https://yusufuzun03.github.io/NBA_stat_analyzer/**

A free, fast fantasy-basketball analytics app built around the **9-category z-score engine**
that powers the pro tools (Hashtag Basketball, Basketball Monster, FantaZscores) — plus punt
builds, trades, draft tiers, matchups, streaming and 25+ seasons of per-game stats. No login,
no API key; it runs entirely from static data snapshots that refresh nightly.

> Not affiliated with the NBA or Sports Reference LLC. Data from
> [basketball-reference.com](https://www.basketball-reference.com); for fantasy &
> informational use only.

## Features

| Feature | What it does |
|---|---|
| 9-cat z-score rankings | Ranks players by total z across FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TOV (percentages volume-weighted). Toggle **Z-score ⇄ per-game** to see real numbers. |
| Seasons 2000-01 → today | Browse any season back to 2000-01 from the season dropdown. |
| Punt analyzer + presets | Drop categories you're punting; everything re-ranks live. One-click common builds. |
| Draft tiers | Rosterable pool grouped into value tiers — a printable snake-draft cheat sheet. |
| Positional rankings | Top values at each position (PG/SG/SF/PF/C). |
| Trade analyzer | Compare both sides category-by-category with a letter grade. |
| Compare tray | Pin up to 4 players and compare them side-by-side on a shared radar + stat table. |
| My Team | Star players (or **import** a roster) → category strengths, a **punt optimizer**, **pickup targets**, weekly projection. |
| Roster import | Build My Team in one shot: paste a name list from any platform, or pull a **Sleeper** league by ID. Names are fuzzy-matched to players (diacritics/suffixes handled); runs fully client-side, no login. |
| Punt optimizer | Searches punt builds (up to 3 cats) and ranks them by your roster's average league-wide percentile under each — i.e. the build your *specific* players are most elite in, not just your weakest categories. Each build shows the cats it leans into; one click applies it to the board. |
| Pickup targets | Surfaces the best available players (not on your roster) for your weakest **kept** categories — answering "who fixes what I'm missing", punt-build aware. |
| Best punt fits (per player) | Each player profile shows the single-cat punts that raise *that* player's league rank the most (e.g. Giannis: Punt FT% #69→#8) — tap to apply. |
| Matchup simulator | Project a head-to-head week and a category score (e.g. 6–3), with **toss-up** categories (decided within 6%) flagged so you see how clean or shaky the projection is. |
| Schedule & streamers | Weekly Mon–Sun calendar, back-to-backs, and best schedule-weighted pickups. |
| Player profiles | Photo, advanced stats, radar, career table, recent form + a consistency (boom/bust) rating. |

## How it's hosted

- **Frontend**: a static site (`frontend/`) served by **GitHub Pages** — the public app. It
  reads JSON snapshots in `frontend/data/`, so it needs no server at runtime.
- **Backend** (`backend/`): Python + FastAPI. Used locally and by the data pipeline to scrape
  basketball-reference and generate those snapshots; **not** deployed publicly.
- **Auto-refresh**: GitHub Actions regenerate the snapshots and redeploy (see
  *Keeping the data fresh* below), so the live app stays current without manual work.

## Quick start

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then open <http://127.0.0.1:8000/docs> for interactive API docs, or hit
<http://127.0.0.1:8000/api/players> for the ranked player list.

The first `/api/players` request warms the cache from basketball-reference (a few seconds);
the first `/api/schedule/week` request scrapes the monthly schedule pages (~25s, throttled).
Subsequent requests are served from `cache/` until the 12h TTL expires.

## Tests

```bash
cd backend
pytest
```

## Keeping the data fresh

The hosted site is static — it reads JSON snapshots in `frontend/data/`. Two
GitHub Actions keep those snapshots current and redeploy automatically:

| Workflow | Schedule | Regenerates |
|---|---|---|
| `update-core.yml` | nightly (09:00 UTC) | players, schedule, advanced, manifest |
| `update-full.yml` | weekly (Mon 10:00 UTC) | the above **plus** career + game logs |

Season-to-date averages live in the `players` snapshot, so new games, trades and
called-up players show up within a day. The slow per-player scrapes (career
tables, game logs behind the Recent Form / consistency views) refresh weekly to
stay polite to basketball-reference. Both can also be run on demand from the
Actions tab (`workflow_dispatch`).

The active season is inferred from the date (`config.current_season()`), so when
a new NBA season tips off in October the refresh targets it automatically and
`manifest.json` adds it to the site's season dropdown — no code change needed.

To regenerate locally instead:

```bash
cd backend
python scripts/gen_players.py    # value board / rankings (fast)
python scripts/gen_schedule.py   # schedule / streamers (~25s)
python scripts/gen_advanced.py   # advanced stats (fast)
python scripts/gen_career.py     # career tables (slow, per-player)
python scripts/gen_gamelog.py    # game logs (slow, per-player)
python scripts/gen_manifest.py   # season dropdown manifest
```

## Project layout

```
backend/
  app/
    main.py            FastAPI app, routes, CORS
    models.py          Pydantic schemas
    data/nba_client.py basketball-reference scraper + disk cache
    engine/
      zscore.py        9-cat z-score computation
      punt.py          punt re-ranking
      trade.py         trade grading
      projections.py   rest-of-season heuristic
      schedule.py      games-per-week / streaming
  tests/               z-score math tests
frontend/              static GitHub Pages app (the public site)
cache/                 runtime data cache (gitignored)
```

## License

[MIT](./LICENSE). Data is the property of basketball-reference.com / Sports Reference LLC;
BoxScore is an independent, unaffiliated project.

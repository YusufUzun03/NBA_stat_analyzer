# BoxScore — NBA Fantasy Stat Analyzer

A fantasy-basketball analytics tool built around the **9-category z-score engine** that powers
the best fantasy tools (Hashtag Basketball, Basketball Monster, FantaZscores), plus a live
**punt-strategy analyzer**, a **trade analyzer**, **rest-of-season projections**, and a
**games-per-week / streaming** matchup tool.

- **Backend** (this repo): Python + FastAPI. Pulls live data from
  [basketball-reference.com](https://www.basketball-reference.com) (free, no API key,
  globally reachable) and exposes a clean JSON API. Player ids are basketball-reference
  slugs (e.g. `jokicni01`).
- **Frontend**: designed separately (Claude Design) and consumes the API documented in
  [`API.md`](./API.md).

> **Data-source note:** `stats.nba.com` is geo-fenced to the US and times out from many
> regions, so this project sources data from basketball-reference instead, which works
> worldwide. Responses are cached under `cache/` (12h TTL) to stay polite to BR.

## Features (v1)

| Feature | What it does |
|---|---|
| 9-cat z-score rankings | Ranks players by total z-score across FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TOV. Percentages are volume-weighted. |
| Punt analyzer | Drop any categories you're punting; everything re-ranks live. |
| Trade analyzer | Compare players given vs received; per-category deltas + a letter grade. |
| Rest-of-season projections | v1 baseline = season-to-date line + z-value (a recent-form blend hook is in place for a future upgrade). |
| Matchup / schedule | Games per team per week, back-to-backs, and top streaming targets. |

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
frontend/              (your Claude-designed UI)
cache/                 runtime data cache (gitignored)
```

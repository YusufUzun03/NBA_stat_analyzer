# API Contract

Base URL (dev): `http://127.0.0.1:8000`

All responses are JSON. CORS is open (`*`) in dev so a separately-hosted frontend can call it.
Interactive docs: `/docs`.

Common concepts:
- **Player ids** are basketball-reference slugs (strings), e.g. `jokicni01`, `wembavi01`.
- **Categories** (`cat` keys): `fg`, `ft`, `tpm`, `pts`, `reb`, `ast`, `stl`, `blk`, `tov`.
- **`pool`** (int, default `156`): size of the player pool used to compute league mean/std
  (12 teams × 13 roster spots). Smaller pool = tighter, more "rosterable" baseline.
- **`punt`** (csv): categories to ignore, e.g. `punt=ft,tov`. Re-ranks live.

---

### `GET /api/players`
Ranked players by total z-score.

Query params: `pool` (int), `punt` (csv), `limit` (int, default 200), `season` (e.g. `2025-26`).

```jsonc
{
  "season": "2025-26",
  "pool": 156,
  "punt": ["ft"],
  "players": [
    {
      "id": "jokicni01", "name": "Nikola Jokić", "team": "DEN", "pos": "C",
      "gp": 30, "min": 34.5,
      "stats": { "fg_pct": 0.58, "ft_pct": 0.81, "tpm": 1.2, "pts": 27.0,
                 "reb": 12.8, "ast": 10.1, "stl": 1.6, "blk": 0.7, "tov": 3.1 },
      "z": { "fg": 2.1, "tpm": 0.1, "pts": 1.3, "reb": 2.4, "ast": 3.0,
             "stl": 1.0, "blk": 0.2, "tov": -1.1 },
      "total": 8.9, "rank": 1
    }
  ]
}
```
(Punted categories are omitted from `z` and from `total`.)

---

### `GET /api/players/{id}`
Full detail for one player (same shape as a `players[]` entry). Honors `pool` and `punt`.

---

### `POST /api/trade`
Grade a trade.

```jsonc
// request
{ "give": ["wembavi01"], "receive": ["jokicni01"], "pool": 156, "punt": [] }

// response
{
  "give":    { "players": [...], "z_totals": { "pts": 1.3, "reb": 2.4, ... }, "total": 8.9 },
  "receive": { "players": [...], "z_totals": { "pts": 2.1, "reb": 1.0, ... }, "total": 9.4 },
  "delta_by_cat": { "pts": 0.8, "reb": -1.4, ... },
  "net": 0.5,
  "grade": "B+",
  "verdict": "Slight win for the receiving side."
}
```

---

### `GET /api/projections`
Rest-of-season projected per-game line + projected z-value. v1 baseline is the
season-to-date line (a recent-form blend hook exists for a future upgrade).

Query params: `range` (`ros` default), `pool`, `punt`, `limit`.

```jsonc
{ "range": "ros", "season": "2025-26", "players": [
  { "id": "jokicni01", "name": "Nikola Jokić",
    "proj": { "pts": 26.4, "reb": 12.5, "ast": 9.8, ... },
    "proj_total_z": 8.6, "rank": 1 } ] }
```

---

### `GET /api/schedule/week`
Games per team for a week + streaming targets.

Query params: `date` (`YYYY-MM-DD`, any day in the target week).

```jsonc
{
  "week_start": "2026-01-12", "week_end": "2026-01-18",
  "teams": [ { "team": "DEN", "games": 4, "back_to_backs": 1,
               "dates": ["2026-01-12","2026-01-14","2026-01-16","2026-01-17"] } ],
  "streaming_targets": [ { "team": "DEN", "games": 4 } ]
}
```

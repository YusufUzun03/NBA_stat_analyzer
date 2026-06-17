"""FastAPI app exposing the NBA fantasy analyzer engine.

Run: `uvicorn app.main:app --reload`  (from the backend/ directory)
Docs: http://127.0.0.1:8000/docs
"""
from __future__ import annotations

import secrets

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from .config import DEFAULT_POOL, DEFAULT_SEASON, parse_punt
from .models import TradeRequest
from . import service
from . import yahoo

app = FastAPI(
    title="NBA Fantasy Stat Analyzer",
    version="1.0.0",
    description="9-category z-score rankings, punt analysis, trades, projections, schedule.",
)

# Open CORS in dev so a separately-hosted frontend (Claude Design) can call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"name": "NBA Fantasy Stat Analyzer API", "docs": "/docs", "health": "ok"}


@app.get("/api/players")
def get_players(
    pool: int = Query(DEFAULT_POOL, ge=20, le=500),
    punt: str | None = Query(None, description="csv of categories, e.g. ft,tov"),
    limit: int = Query(200, ge=1, le=1000),
    season: str = Query(DEFAULT_SEASON),
    min_minutes: float = Query(12.0, ge=0, le=40, description="per-game minutes floor"),
):
    return service.rankings(season, pool, parse_punt(punt), limit, min_minutes)


@app.get("/api/players/{player_id}")
def get_player(
    player_id: str,
    pool: int = Query(DEFAULT_POOL, ge=20, le=500),
    punt: str | None = Query(None),
    season: str = Query(DEFAULT_SEASON),
):
    detail = service.player_detail(season, player_id, pool, parse_punt(punt))
    if detail is None:
        raise HTTPException(status_code=404, detail="Player not found or below minutes threshold")
    return detail


@app.get("/api/players/{player_id}/career")
def get_career(player_id: str):
    from .data.nba_client import get_career_stats
    return get_career_stats(player_id)


@app.get("/api/players/{player_id}/gamelog")
def get_gamelog(player_id: str, season: str = Query(DEFAULT_SEASON)):
    from .data.nba_client import get_game_log
    return get_game_log(player_id, season)


@app.get("/api/advanced")
def get_advanced(season: str = Query(DEFAULT_SEASON)):
    from .data.nba_client import get_advanced_stats
    return get_advanced_stats(season)


@app.get("/api/players/{player_id}/best-punts")
def get_best_punts(
    player_id: str,
    pool: int = Query(DEFAULT_POOL, ge=20, le=500),
    season: str = Query(DEFAULT_SEASON),
    top: int = Query(4, ge=1, le=9),
):
    from .engine.punt import best_punts_for_player
    return best_punts_for_player(service.load_players(season), player_id, pool=pool, top=top)


@app.post("/api/trade")
def post_trade(req: TradeRequest, season: str = Query(DEFAULT_SEASON)):
    if not req.give and not req.receive:
        raise HTTPException(status_code=400, detail="Provide at least one player in give/receive")
    return service.grade_trade(season, req.give, req.receive, req.pool, parse_punt(req.punt))


@app.get("/api/projections")
def get_projections(
    range: str = Query("ros"),
    pool: int = Query(DEFAULT_POOL, ge=20, le=500),
    punt: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    season: str = Query(DEFAULT_SEASON),
):
    return service.projections_ros(season, pool, parse_punt(punt), limit)


@app.get("/api/schedule/week")
def get_schedule_week(
    date: str = Query(..., description="any day in the target week, YYYY-MM-DD"),
    season: str = Query(DEFAULT_SEASON),
):
    return service.schedule_week(season, date)


# --- Yahoo Fantasy (OAuth proxy; see app/yahoo.py) -------------------------
@app.get("/api/yahoo/status")
def yahoo_status():
    """Whether Yahoo is set up (creds present) and currently connected."""
    return {"configured": yahoo.is_configured(), "connected": yahoo.is_connected()}


@app.get("/api/yahoo/login")
def yahoo_login():
    """Kick off OAuth: redirect the user to Yahoo's consent screen."""
    if not yahoo.is_configured():
        raise HTTPException(status_code=503, detail="Yahoo not configured. Set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET.")
    state = secrets.token_urlsafe(16)
    yahoo.save_state(state)
    return RedirectResponse(yahoo.authorization_url(state))


@app.get("/api/yahoo/callback")
def yahoo_callback(code: str = Query(None), state: str = Query(None), error: str = Query(None)):
    """Yahoo redirects here with the auth code; exchange it and close the tab."""
    def page(msg: str, ok: bool) -> HTMLResponse:
        return HTMLResponse(
            f"""<!doctype html><meta charset=utf-8><title>BoxScore × Yahoo</title>
            <body style="font-family:system-ui;background:#0a0c14;color:#f4f6fb;display:grid;place-items:center;height:100vh;margin:0">
            <div style="text-align:center;max-width:420px;padding:24px">
              <div style="font-size:40px">{'✅' if ok else '⚠️'}</div>
              <h2>{msg}</h2>
              <p style="color:#9aa3b8">You can close this tab and return to BoxScore.</p>
            </div>
            <script>setTimeout(function(){{window.close();}},1200);</script>""",
            status_code=200 if ok else 400,
        )
    if error:
        return page(f"Yahoo denied access ({error}).", False)
    if not code or not yahoo.check_state(state):
        return page("Invalid or expired login attempt. Please try again.", False)
    try:
        yahoo.exchange_code(code)
    except yahoo.YahooError as e:
        return page(str(e), False)
    return page("Connected to Yahoo!", True)


@app.get("/api/yahoo/teams")
def yahoo_teams():
    """The logged-in user's NBA teams + rosters (player names) for importing."""
    try:
        return {"teams": yahoo.fetch_user_teams()}
    except yahoo.YahooError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.post("/api/yahoo/disconnect")
def yahoo_disconnect():
    yahoo.disconnect()
    return {"connected": False}

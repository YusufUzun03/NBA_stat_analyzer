"""FastAPI app exposing the NBA fantasy analyzer engine.

Run: `uvicorn app.main:app --reload`  (from the backend/ directory)
Docs: http://127.0.0.1:8000/docs
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import DEFAULT_POOL, DEFAULT_SEASON, parse_punt
from .models import TradeRequest
from . import service

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

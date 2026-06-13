"""Deterministic engine tests on synthetic data (no network / nba_api needed)."""
from __future__ import annotations

from app.engine import projections, schedule, trade
from app.engine.zscore import compute_values


def make_player(pid, name, **stats):
    base = dict(
        id=pid, name=name, team="XXX", pos="G", gp=20, min=30.0,
        fgm=5.0, fga=10.0, fg_pct=0.5, ftm=3.0, fta=4.0, ft_pct=0.75,
        tpm=1.0, pts=15.0, reb=5.0, ast=3.0, stl=1.0, blk=0.5, tov=2.0,
    )
    base.update(stats)
    if base["fga"]:
        base["fg_pct"] = base["fgm"] / base["fga"]
    if base["fta"]:
        base["ft_pct"] = base["ftm"] / base["fta"]
    return base


def _pool(extra=None):
    # A spread of players so std > 0 across categories.
    players = [
        make_player(i, f"P{i}", pts=10 + i, reb=3 + i * 0.5, ast=2 + i * 0.3,
                    stl=0.5 + i * 0.1, blk=0.2 + i * 0.1, tov=1 + i * 0.2,
                    tpm=0.5 + i * 0.2, fgm=4 + i * 0.2, fga=9 + i * 0.1,
                    ftm=2 + i * 0.2, fta=3 + i * 0.1)
        for i in range(1, 31)
    ]
    if extra:
        players.extend(extra)
    return players


def _find(results, pid):
    return next(r for r in results if r["id"] == pid)


def test_counting_zscore_orders_by_points():
    players = _pool()
    results = compute_values(players, pool=30)
    # higher index players have more points -> P30 should outrank P1 overall
    assert _find(results, 30)["rank"] < _find(results, 1)["rank"]


def test_turnovers_are_inverted():
    low = make_player(101, "LowTOV", tov=0.5)
    high = make_player(102, "HighTOV", tov=6.0)
    results = compute_values(_pool([low, high]), pool=32)
    # identical except TOV; fewer turnovers must score higher in the tov category
    assert _find(results, 101)["z"]["tov"] > _find(results, 102)["z"]["tov"]


def test_pct_is_volume_weighted():
    # Same FG% (0.75, comfortably above the pool's ~0.67 aggregate) but very
    # different volume -> for an above-average shooter, higher volume yields a
    # larger positive impact, hence a higher FG% z-score.
    hi_vol = make_player(201, "HiVol", fgm=15.0, fga=20.0)
    lo_vol = make_player(202, "LoVol", fgm=1.5, fga=2.0)
    results = compute_values(_pool([hi_vol, lo_vol]), pool=32)
    assert _find(results, 201)["z"]["fg"] > _find(results, 202)["z"]["fg"]


def test_punt_removes_category_from_total():
    players = _pool()
    full = compute_values(players, pool=30)
    punted = compute_values(players, pool=30, punt=["pts"])
    # pts must be absent from z when punted
    assert "pts" not in _find(punted, 15)["z"]
    assert "pts" in _find(full, 15)["z"]


def test_min_minutes_filter_excludes_bench():
    bench = make_player(301, "Benchwarmer", min=5.0)
    results = compute_values(_pool([bench]), pool=30)
    assert all(r["id"] != 301 for r in results)


def test_trade_fair_deal_is_even():
    players = _pool()
    # swap two near-identical mid players
    res = trade.analyze_trade(players, give=[15], receive=[16], pool=30)
    assert abs(res["net"]) < 1.0
    assert res["grade"] in {"C", "B", "C-"}


def test_trade_lopsided_favors_receiver():
    players = _pool()
    res = trade.analyze_trade(players, give=[1], receive=[30], pool=30)
    assert res["net"] > 0
    assert res["grade"] in {"A+", "A", "B+", "B"}


def test_projection_blend_moves_toward_recent():
    season = [make_player(1, "P1", pts=10.0)]
    recent = [make_player(1, "P1", pts=30.0)]
    proj = projections.project(season, recent, weight_recent=0.5)
    assert proj[0]["pts"] == 20.0  # halfway between 10 and 30


def test_schedule_week_counts_and_b2b():
    games = [
        {"date": "2026-01-12", "home": "DEN", "away": "LAL"},  # Mon
        {"date": "2026-01-13", "home": "DEN", "away": "PHX"},  # Tue (b2b)
        {"date": "2026-01-15", "home": "GSW", "away": "DEN"},  # Thu
        {"date": "2026-01-20", "home": "DEN", "away": "BOS"},  # next week, excluded
    ]
    wk = schedule.games_per_week(games, "2026-01-14")
    den = next(t for t in wk["teams"] if t["team"] == "DEN")
    assert den["games"] == 3
    assert den["back_to_backs"] == 1
    assert wk["week_start"] == "2026-01-12" and wk["week_end"] == "2026-01-18"

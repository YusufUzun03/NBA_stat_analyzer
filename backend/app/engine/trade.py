"""Trade analyzer: compare players given vs received in z-score terms."""
from __future__ import annotations

from ..config import CATEGORIES
from .zscore import compute_values


def _grade(net: float) -> tuple[str, str]:
    """Grade a trade from the *receiving* side. `net` = receive_total - give_total (z units)."""
    table = [
        (4.0, "A+", "Huge win for the receiving side."),
        (2.5, "A",  "Clear win for the receiving side."),
        (1.2, "B+", "Solid win for the receiving side."),
        (0.4, "B",  "Slight win for the receiving side."),
        (-0.4, "C", "Fair / even trade."),
        (-1.2, "C-", "Slight loss for the receiving side."),
        (-2.5, "D", "Clear loss for the receiving side."),
        (float("-inf"), "F", "Big loss for the receiving side."),
    ]
    for threshold, letter, verdict in table:
        if net >= threshold:
            return letter, verdict
    return "F", "Big loss for the receiving side."


def _side(results_by_id: dict, ids: list, punt: list[str]) -> dict:
    players, totals = [], {c["key"]: 0.0 for c in CATEGORIES if c["key"] not in punt}
    total = 0.0
    for pid in ids:
        r = results_by_id.get(pid)
        if r is None:
            continue
        players.append({"id": r["id"], "name": r["name"], "total": r["total"]})
        for k, v in r["z"].items():
            totals[k] = round(totals.get(k, 0.0) + v, 3)
        total += r["total"]
    return {"players": players, "z_totals": totals, "total": round(total, 3)}


def analyze_trade(
    players: list[dict],
    give: list,
    receive: list,
    pool: int,
    punt: list[str] | None = None,
) -> dict:
    punt = punt or []
    results = compute_values(players, pool=pool, punt=punt)
    by_id = {r["id"]: r for r in results}

    give_side = _side(by_id, give, punt)
    recv_side = _side(by_id, receive, punt)

    delta_by_cat = {}
    for cat in CATEGORIES:
        k = cat["key"]
        if k in punt:
            continue
        delta_by_cat[k] = round(
            recv_side["z_totals"].get(k, 0.0) - give_side["z_totals"].get(k, 0.0), 3
        )

    net = round(recv_side["total"] - give_side["total"], 3)
    letter, verdict = _grade(net)
    return {
        "give": give_side,
        "receive": recv_side,
        "delta_by_cat": delta_by_cat,
        "net": net,
        "grade": letter,
        "verdict": verdict,
    }

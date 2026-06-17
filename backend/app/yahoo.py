"""Yahoo Fantasy integration — OAuth 2.0 + roster fetch.

Yahoo's Fantasy API can't be reached from the browser (OAuth needs a client
secret, and Yahoo serves no CORS headers), so this backend acts as the proxy:
it holds the secret, runs the OAuth dance, and exposes a clean roster endpoint
the static frontend can call.

Scope is single-user / local by design: the token is cached in one file under
``cache/``. That's intentional — the backend is meant to run on the user's own
machine (``uvicorn``), not as a public multi-tenant service. Pure helpers
(URL building + JSON parsing) are split out so they're unit-testable without
live credentials.
"""
from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import urlencode

import requests

from .config import (
    CACHE_DIR,
    YAHOO_CLIENT_ID,
    YAHOO_CLIENT_SECRET,
    YAHOO_REDIRECT_URI,
)

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2"
SCOPE = "fspt-r"  # Fantasy Sports, read-only

TOKEN_FILE = CACHE_DIR / "yahoo_token.json"
STATE_FILE = CACHE_DIR / "yahoo_state.json"


class YahooError(RuntimeError):
    """Raised for any recoverable Yahoo flow problem (surface to the user)."""


def is_configured() -> bool:
    """True when client id/secret are present so the flow can even start."""
    return bool(YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET)


def is_connected() -> bool:
    return TOKEN_FILE.exists()


# --- OAuth flow ------------------------------------------------------------
def authorization_url(state: str) -> str:
    """Yahoo consent URL to redirect the user to."""
    params = {
        "client_id": YAHOO_CLIENT_ID,
        "redirect_uri": YAHOO_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def save_state(state: str) -> None:
    STATE_FILE.write_text(json.dumps({"state": state}), encoding="utf-8")


def check_state(state: str) -> bool:
    if not STATE_FILE.exists():
        return False
    try:
        saved = json.loads(STATE_FILE.read_text(encoding="utf-8")).get("state")
    except (ValueError, OSError):
        return False
    return bool(state) and state == saved


def _store_token(data: dict) -> None:
    # Stamp an absolute expiry so refresh decisions don't depend on call timing.
    data = dict(data)
    data["expires_at"] = time.time() + float(data.get("expires_in", 3600)) - 60
    TOKEN_FILE.write_text(json.dumps(data), encoding="utf-8")


def _load_token() -> dict | None:
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None


def exchange_code(code: str) -> None:
    """Trade an authorization code for access + refresh tokens, then cache them."""
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "redirect_uri": YAHOO_REDIRECT_URI,
            "code": code,
        },
        auth=(YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET),
        timeout=20,
    )
    if not resp.ok:
        raise YahooError(f"Token exchange failed ({resp.status_code}): {resp.text[:200]}")
    _store_token(resp.json())


def _refresh(refresh_token: str) -> dict:
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "redirect_uri": YAHOO_REDIRECT_URI,
            "refresh_token": refresh_token,
        },
        auth=(YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET),
        timeout=20,
    )
    if not resp.ok:
        raise YahooError("Yahoo session expired — please reconnect.")
    data = resp.json()
    # Yahoo may omit the refresh_token on refresh; keep the old one.
    data.setdefault("refresh_token", refresh_token)
    _store_token(data)
    return data


def _valid_access_token() -> str:
    tok = _load_token()
    if not tok:
        raise YahooError("Not connected to Yahoo. Connect first.")
    if time.time() >= tok.get("expires_at", 0):
        tok = _refresh(tok.get("refresh_token", ""))
    return tok["access_token"]


def disconnect() -> None:
    for f in (TOKEN_FILE, STATE_FILE):
        try:
            f.unlink()
        except OSError:
            pass


# --- Fantasy API -----------------------------------------------------------
def _api_get(path: str) -> dict:
    token = _valid_access_token()
    resp = requests.get(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params={"format": "json"},
        timeout=20,
    )
    if resp.status_code == 401:
        raise YahooError("Yahoo session expired — please reconnect.")
    if not resp.ok:
        raise YahooError(f"Yahoo API error ({resp.status_code}).")
    return resp.json()


def fetch_user_teams() -> list[dict]:
    """The logged-in user's NBA teams, each with its roster of player names.

    Returns ``[{"team_key", "name", "league", "players": [name, ...]}]`` —
    the frontend matches those names to BoxScore players.
    """
    teams_payload = _api_get("/users;use_login=1/games;game_keys=nba/teams")
    teams = extract_teams(teams_payload)
    out = []
    for t in teams:
        roster = _api_get(f"/team/{t['team_key']}/roster/players")
        out.append({
            "team_key": t["team_key"],
            "name": t.get("name") or t["team_key"],
            "league": t.get("league", ""),
            "players": extract_player_names(roster),
        })
    return out


# --- JSON parsing (pure; unit-tested) --------------------------------------
# Yahoo's JSON is deeply nested with numeric string keys and "count" markers.
# Rather than index brittle paths, walk the tree and pull what we recognize.

def extract_player_names(payload: Any) -> list[str]:
    """Every player's full name in a payload, de-duped, order-preserved.

    A player carries ``{"name": {"full": "..."}}``; team names are plain
    strings, so keying on ``name`` being a dict with ``full`` selects players
    only.
    """
    names: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            nm = node.get("name")
            if isinstance(nm, dict) and nm.get("full"):
                names.append(nm["full"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for el in node:
                walk(el)

    walk(payload)
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def extract_teams(payload: Any) -> list[dict]:
    """``[{"team_key", "name", "league"}]`` for every team in a payload.

    A team's attribute list contains both ``{"team_key": ...}`` and
    ``{"name": "<string>"}`` as siblings; we pair them per list. League name
    (a ``{"name": ...}`` higher up) is best-effort and may be blank.
    """
    teams: list[dict] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            tk = name = None
            for el in node:
                if isinstance(el, dict):
                    if isinstance(el.get("team_key"), str):
                        tk = el["team_key"]
                    if isinstance(el.get("name"), str):
                        name = el["name"]
            if tk:
                teams.append({"team_key": tk, "name": name, "league": ""})
            for el in node:
                walk(el)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(payload)
    # Dedupe by team_key, keeping the first (most attribute-rich) hit.
    seen: dict[str, dict] = {}
    for t in teams:
        seen.setdefault(t["team_key"], t)
    return list(seen.values())

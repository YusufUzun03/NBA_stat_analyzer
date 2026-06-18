"""Yahoo Fantasy integration — stateless, multi-user OAuth proxy.

Yahoo's Fantasy API can't be reached from the browser (OAuth needs a client
secret, and Yahoo serves no CORS headers), so this backend is the proxy. It is
deliberately **stateless**: it never stores user tokens. The owner registers one
Yahoo app + deploys this once; every visitor's tokens live in *their own
browser* and are passed in per request. That means no database, no sessions —
it scales to any number of users and the server holds no personal data.

Flow:
  1. frontend opens  /api/yahoo/login?return=<frontend page>
  2. we redirect to Yahoo with a *signed* state that embeds the return URL
     (HMAC over the client secret → CSRF-proof, no server-side state needed)
  3. Yahoo → /api/yahoo/callback?code&state ; we verify state, exchange the
     code, and redirect to the return URL with tokens in the URL fragment
  4. the frontend stores those tokens (localStorage) and sends the access token
     to /api/yahoo/teams ; /api/yahoo/refresh renews it when it expires

Pure helpers (URL building, state signing, JSON parsing) are unit-tested
without live credentials.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import urlencode

import requests

from .config import (
    YAHOO_ALLOWED_RETURNS,
    YAHOO_CLIENT_ID,
    YAHOO_CLIENT_SECRET,
    YAHOO_REDIRECT_URI,
)

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2"
SCOPE = "fspt-r"          # Fantasy Sports, read-only
STATE_TTL = 600           # signed state valid for 10 minutes


class YahooError(RuntimeError):
    """Recoverable Yahoo flow problem (surface message to the user)."""


def is_configured() -> bool:
    return bool(YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET)


# --- return-URL allowlist (prevents open-redirect / token theft) -----------
def is_allowed_return(url: str) -> bool:
    """A return URL must start with one of the configured allowed origins."""
    return bool(url) and any(url.startswith(p) for p in YAHOO_ALLOWED_RETURNS)


# --- signed state (stateless CSRF) -----------------------------------------
def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sig(raw: str) -> str:
    return hmac.new(YAHOO_CLIENT_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[:32]


def make_state(return_url: str, now: float | None = None) -> str:
    payload = {"r": return_url, "exp": (now or time.time()) + STATE_TTL}
    raw = _b64e(json.dumps(payload).encode())
    return f"{raw}.{_sig(raw)}"


def read_state(state: str, now: float | None = None) -> dict | None:
    """Return the state payload if the signature is valid and unexpired."""
    if not state or "." not in state:
        return None
    raw, sig = state.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sig(raw)):
        return None
    try:
        payload = json.loads(_b64d(raw))
    except (ValueError, json.JSONDecodeError):
        return None
    if float(payload.get("exp", 0)) < (now or time.time()):
        return None
    return payload


def authorization_url(state: str) -> str:
    params = {
        "client_id": YAHOO_CLIENT_ID,
        "redirect_uri": YAHOO_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


# --- token exchange / refresh (return tokens; never stored server-side) -----
def exchange_code(code: str) -> dict:
    resp = requests.post(
        TOKEN_URL,
        data={"grant_type": "authorization_code", "redirect_uri": YAHOO_REDIRECT_URI, "code": code},
        auth=(YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET),
        timeout=20,
    )
    if not resp.ok:
        raise YahooError(f"Token exchange failed ({resp.status_code}).")
    return _shape_token(resp.json())


def refresh_token(refresh: str) -> dict:
    resp = requests.post(
        TOKEN_URL,
        data={"grant_type": "refresh_token", "redirect_uri": YAHOO_REDIRECT_URI, "refresh_token": refresh},
        auth=(YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET),
        timeout=20,
    )
    if not resp.ok:
        raise YahooError("Yahoo session expired — please reconnect.")
    data = resp.json()
    data.setdefault("refresh_token", refresh)  # Yahoo may omit it on refresh
    return _shape_token(data)


def _shape_token(data: dict) -> dict:
    """Normalize to just what the browser needs."""
    return {
        "access_token": data.get("access_token", ""),
        "refresh_token": data.get("refresh_token", ""),
        "expires_in": int(data.get("expires_in", 3600)),
    }


# --- Fantasy API (caller supplies the user's access token) ------------------
def _api_get(path: str, access_token: str) -> dict:
    resp = requests.get(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"format": "json"},
        timeout=20,
    )
    if resp.status_code == 401:
        raise YahooError("expired")
    if not resp.ok:
        raise YahooError(f"Yahoo API error ({resp.status_code}).")
    return resp.json()


def fetch_user_teams(access_token: str) -> list[dict]:
    """The logged-in user's NBA teams, each with its roster of player names."""
    teams_payload = _api_get("/users;use_login=1/games;game_keys=nba/teams", access_token)
    teams = extract_teams(teams_payload)
    out = []
    for t in teams:
        roster = _api_get(f"/team/{t['team_key']}/roster/players", access_token)
        out.append({
            "team_key": t["team_key"],
            "name": t.get("name") or t["team_key"],
            "players": extract_player_names(roster),
        })
    return out


# --- JSON parsing (pure; unit-tested) --------------------------------------
def extract_player_names(payload: Any) -> list[str]:
    """Every player's full name, de-duped, order-preserved.

    Players carry ``{"name": {"full": ...}}``; team names are plain strings, so
    keying on ``name`` being a dict with ``full`` selects players only.
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
    """``[{"team_key", "name"}]`` for every team in a payload.

    A team's attribute list holds ``{"team_key": ...}`` and ``{"name": "<str>"}``
    as siblings; pair them per list.
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
                teams.append({"team_key": tk, "name": name})
            for el in node:
                walk(el)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(payload)
    seen: dict[str, dict] = {}
    for t in teams:
        seen.setdefault(t["team_key"], t)
    return list(seen.values())

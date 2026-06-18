"""Yahoo JSON parser tests on faithful fixtures (no network / no credentials).

Yahoo's Fantasy JSON is deeply nested with numeric-string keys; these fixtures
mirror that real shape so the recursive parsers are exercised the way live
responses would exercise them.
"""
from __future__ import annotations

from app import yahoo

# Shape of /users;use_login=1/games;game_keys=nba/teams?format=json
TEAMS_PAYLOAD = {
    "fantasy_content": {
        "users": {
            "0": {
                "user": [
                    {"guid": "ABC"},
                    {"games": {
                        "0": {"game": [
                            {"game_key": "428", "code": "nba", "name": "Basketball"},
                            {"teams": {
                                "0": {"team": [
                                    [
                                        {"team_key": "428.l.12345.t.6"},
                                        {"team_id": "6"},
                                        {"name": "Splash Bros"},
                                        {"url": "https://..."},
                                    ],
                                    {"roster_adds": {"value": "0"}},
                                ]},
                                "count": 1,
                            }},
                        ]},
                        "count": 1,
                    }},
                ]
            },
            "count": 1,
        }
    }
}

# Shape of /team/{key}/roster/players?format=json
ROSTER_PAYLOAD = {
    "fantasy_content": {
        "team": [
            [{"team_key": "428.l.12345.t.6"}, {"name": "Splash Bros"}],
            {"roster": {
                "0": {"players": {
                    "0": {"player": [[
                        {"player_key": "428.p.5583"},
                        {"player_id": "5583"},
                        {"name": {"full": "Stephen Curry", "first": "Stephen", "last": "Curry"}},
                        {"editorial_team_abbr": "GSW"},
                    ], {"selected_position": [{"position": "PG"}]}]},
                    "1": {"player": [[
                        {"player_key": "428.p.6018"},
                        {"name": {"full": "Draymond Green", "first": "Draymond", "last": "Green"}},
                    ]]},
                    "2": {"player": [[
                        {"player_key": "428.p.6017"},
                        {"name": {"full": "Jimmy Butler", "first": "Jimmy", "last": "Butler"}},
                    ]]},
                    "count": 3,
                }},
                "is_editable": 0,
            }},
        ]
    }
}


def test_extract_teams_pairs_key_and_name():
    teams = yahoo.extract_teams(TEAMS_PAYLOAD)
    assert teams == [{"team_key": "428.l.12345.t.6", "name": "Splash Bros"}]


def test_extract_player_names_in_order():
    names = yahoo.extract_player_names(ROSTER_PAYLOAD)
    assert names == ["Stephen Curry", "Draymond Green", "Jimmy Butler"]


def test_team_name_string_is_not_a_player():
    # "Splash Bros" is a plain-string team name, not a {"full": ...} player name.
    assert "Splash Bros" not in yahoo.extract_player_names(ROSTER_PAYLOAD)


def test_player_names_dedupe_and_preserve_order():
    dup = {"a": {"name": {"full": "X"}}, "b": [{"name": {"full": "Y"}}, {"name": {"full": "X"}}]}
    assert yahoo.extract_player_names(dup) == ["X", "Y"]


def test_extract_handles_empty_and_garbage():
    assert yahoo.extract_player_names({}) == []
    assert yahoo.extract_teams([]) == []
    assert yahoo.extract_player_names(None) == []


def test_authorization_url_has_required_params():
    url = yahoo.authorization_url("xyz")
    assert url.startswith(yahoo.AUTH_URL)
    for frag in ("response_type=code", "scope=fspt-r", "state=xyz", "redirect_uri="):
        assert frag in url


def test_signed_state_roundtrips():
    st = yahoo.make_state("http://localhost:5500/yahoo-callback.html")
    payload = yahoo.read_state(st)
    assert payload and payload["r"] == "http://localhost:5500/yahoo-callback.html"


def test_tampered_state_is_rejected():
    st = yahoo.make_state("http://localhost/x")
    raw, sig = st.rsplit(".", 1)
    assert yahoo.read_state(f"{raw}.{'0' * len(sig)}") is None       # bad signature
    assert yahoo.read_state("garbage") is None
    assert yahoo.read_state("") is None


def test_expired_state_is_rejected():
    # Issued well in the past relative to the verification "now".
    st = yahoo.make_state("http://localhost/x", now=1000.0)
    assert yahoo.read_state(st, now=1000.0 + yahoo.STATE_TTL + 1) is None


def test_return_url_allowlist():
    assert yahoo.is_allowed_return("http://localhost:5500/cb.html")
    assert yahoo.is_allowed_return("https://yusufuzun03.github.io/NBA_stat_analyzer/")
    assert not yahoo.is_allowed_return("https://evil.example.com/steal")
    assert not yahoo.is_allowed_return("")

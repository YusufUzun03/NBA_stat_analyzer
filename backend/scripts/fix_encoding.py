"""Repair double-encoded (mojibake) UTF-8 strings in already-generated data.

Past scrapes decoded basketball-reference's UTF-8 as Latin-1, so accented
names were saved corrupted ("Jokić" -> "JokiÄ"). The damage is reversible:
re-encode the string as Latin-1 and decode it as UTF-8. Strings that are pure
ASCII are untouched; strings that are already correct (contain real non-Latin-1
code points) raise on the Latin-1 re-encode and are left as-is.

Run from the backend/ directory:
    python scripts/fix_encoding.py

Rewrites the frontend data snapshots and the players/advanced cache in place.
No network access — this only repairs files already on disk.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent.parent
DATA = ROOT / "frontend" / "data"
CACHE = ROOT / "cache"

_changes = 0


def _fix_str(s: str) -> str:
    global _changes
    try:
        repaired = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s            # already correct (non-Latin-1 code points)
    if repaired != s and "�" not in repaired:
        _changes += 1
        return repaired
    return s


def _walk(obj):
    if isinstance(obj, str):
        return _fix_str(obj)
    if isinstance(obj, list):
        return [_walk(x) for x in obj]
    if isinstance(obj, dict):
        return {_walk(k) if isinstance(k, str) else k: _walk(v) for k, v in obj.items()}
    return obj


def _repair_file(path: Path) -> None:
    global _changes
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"  skip {path.name}: {exc}")
        return
    before = _changes
    fixed = _walk(data)
    if _changes > before:
        path.write_text(json.dumps(fixed, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        print(f"  fixed {path.name}: {_changes - before} strings repaired")
    else:
        print(f"  ok   {path.name}: nothing to repair")


def main() -> None:
    print("Repairing frontend data snapshots…")
    for f in sorted(DATA.glob("*.json")):
        _repair_file(f)

    print("Repairing scraper cache (players/advanced)…")
    for f in sorted(CACHE.glob("players_*.json")) + sorted(CACHE.glob("advanced_*.json")):
        _repair_file(f)

    print(f"\nDone. {_changes} strings repaired in total.")


if __name__ == "__main__":
    main()

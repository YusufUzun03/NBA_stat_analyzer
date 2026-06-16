"""Generate frontend/data/manifest.json — the list of seasons the hosted
frontend can load, plus the current one.

Scans frontend/data for players-{season}.json snapshots so the season dropdown
stays in sync automatically as new seasons are generated (no frontend edit
needed when a new NBA season starts).

Run from the backend/ directory:
    python scripts/gen_manifest.py
"""
from __future__ import annotations

import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import DEFAULT_SEASON

DATA_DIR = Path(__file__).parent.parent.parent / "frontend" / "data"
OUT = DATA_DIR / "manifest.json"
_SEASON_RE = re.compile(r"^players-(\d{4}-\d{2})\.json$")


def main() -> None:
    seasons = sorted(
        (m.group(1) for f in DATA_DIR.glob("players-*.json")
         if (m := _SEASON_RE.match(f.name))),
        reverse=True,
    )
    current = DEFAULT_SEASON if DEFAULT_SEASON in seasons else (seasons[0] if seasons else DEFAULT_SEASON)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({
            "seasons": seasons,
            "current": current,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote manifest: current={current}, seasons={seasons} → {OUT}")


if __name__ == "__main__":
    main()

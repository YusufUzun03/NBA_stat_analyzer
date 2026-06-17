# Connecting Yahoo Fantasy to BoxScore

Yahoo (unlike Sleeper) requires an OAuth login and a **client secret**, and its
API sends no CORS headers — so it can't be called from the browser. BoxScore's
**local backend** acts as the proxy: it holds the secret, does the OAuth dance,
and hands the frontend a clean roster. Everything stays on your machine.

This is a **one-time, ~5-minute** setup.

## 1. Register a Yahoo app

1. Go to <https://developer.yahoo.com/apps/create/>.
2. Fill in:
   - **Application Name**: anything (e.g. `BoxScore`).
   - **Application Type**: **Confidential Client**.
   - **Redirect URI(s)**: `http://localhost:8000/api/yahoo/callback`
     (must match exactly; see the note on `https` below if Yahoo rejects it).
   - **API Permissions**: tick **Fantasy Sports** → **Read**.
3. Click **Create App**.
4. Copy the **Client ID (Consumer Key)** and **Client Secret (Consumer Secret)**.

## 2. Give the backend your credentials

Set them as environment variables in the **same terminal** you'll run the
backend from.

**PowerShell (Windows):**
```powershell
$env:YAHOO_CLIENT_ID    = "<your client id>"
$env:YAHOO_CLIENT_SECRET= "<your client secret>"
# optional — only if you changed the redirect URI on the Yahoo app:
# $env:YAHOO_REDIRECT_URI = "http://localhost:8000/api/yahoo/callback"
```

**bash/zsh (macOS/Linux):**
```bash
export YAHOO_CLIENT_ID="<your client id>"
export YAHOO_CLIENT_SECRET="<your client secret>"
```

## 3. Run the backend and open BoxScore

```bash
cd backend
uvicorn app.main:app --reload
```

Open the frontend pointed at the local API (so the redirect host matches):

```
…/frontend/index.html?api=http://localhost:8000
```

## 4. Import your roster

1. **My Team → Import roster → Yahoo league**.
2. **Connect Yahoo →** opens Yahoo's login in a popup; approve access.
3. The popup closes itself; BoxScore loads your NBA team(s).
4. Pick your team → review the matched players → **Add to my team**.

Your token is cached in `cache/yahoo_token.json` so you only log in once
(it auto-refreshes). **Disconnect** in the Yahoo tab deletes it.

## Notes & troubleshooting

- **"Couldn't reach the BoxScore backend"** — the backend isn't running, or you
  didn't open the site with `?api=http://localhost:8000`.
- **"Yahoo isn't set up"** — the env vars weren't set in the terminal that
  launched `uvicorn`. Set them, then restart it.
- **Yahoo rejects an `http` redirect URI** — some accounts require `https`. Set
  `YAHOO_REDIRECT_URI` to an `https://localhost:8000/...` URL **and** run uvicorn
  with TLS (`--ssl-keyfile`/`--ssl-certfile`), or use a tunnel (e.g. ngrok) and
  register that https URL instead.
- **Read-only**: BoxScore requests only the `fspt-r` (read) scope — it can't
  change your Yahoo roster.
- **Hosting it for the live site**: this works locally as-is. To use Yahoo on
  the public GitHub Pages site, deploy this backend (Render/Railway/Fly) and
  register that deployed callback URL on the Yahoo app instead.

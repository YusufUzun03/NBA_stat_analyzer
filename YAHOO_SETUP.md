# Yahoo Fantasy integration (owner setup)

Yahoo (unlike Sleeper) requires an OAuth login and a **client secret**, and its
API serves no CORS headers — so it can't be called from the browser. BoxScore's
backend acts as a **stateless OAuth proxy**: it holds the secret and forwards
calls, but stores **no user data** — each visitor's tokens live in their own
browser. You set this up **once**; after that, users just click **Connect
Yahoo** and pick their team. Nothing to install on their end.

```
Browser ──login──▶ Render proxy ──▶ Yahoo ──code──▶ Render proxy ──tokens(#)──▶ Browser
Browser ──Bearer token──▶ Render proxy ──▶ Yahoo Fantasy API ──roster──▶ Browser
```

## 1. Deploy the backend (Render)

1. Push this repo to GitHub (already done).
2. On <https://render.com> → **New → Blueprint** → pick this repo. It reads
   [`render.yaml`](./render.yaml) and creates a free web service
   (`boxscore-api`). Note its URL, e.g. `https://boxscore-api.onrender.com`.
   - (Or **New → Web Service** manually: Root Dir `backend`, Build
     `pip install -r requirements.txt`, Start
     `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.)

## 2. Register one Yahoo app

1. <https://developer.yahoo.com/apps/create/>
2. **Application Type**: Confidential Client.
3. **Redirect URI**: `https://<your-service>.onrender.com/api/yahoo/callback`
   (must match exactly — Yahoo requires `https`, which Render provides).
4. **API Permissions**: Fantasy Sports → **Read**.
5. Create, then copy **Client ID** and **Client Secret**.

## 3. Configure the env vars on Render

In the Render service → **Environment**:

| Key | Value |
|---|---|
| `YAHOO_CLIENT_ID` | your client id |
| `YAHOO_CLIENT_SECRET` | your client secret |
| `YAHOO_REDIRECT_URI` | `https://<your-service>.onrender.com/api/yahoo/callback` |
| `YAHOO_ALLOWED_RETURNS` | `https://yusufuzun03.github.io,http://localhost,http://127.0.0.1` |

Save → Render redeploys.

## 4. Point the frontend at the proxy

In `frontend/js/main.js`, set `YAHOO_PROXY` to your Render base URL:

```js
const YAHOO_PROXY = (API || "https://boxscore-api.onrender.com").replace(/\/$/, "");
//                          ^ replace with your actual service URL
```

Commit & push → GitHub Pages redeploys. Done — open the live site, **My Team →
Import roster → Yahoo league → Connect Yahoo**.

## Local development

Run the backend locally and point the frontend at it with `?api`:

```powershell
$env:YAHOO_CLIENT_ID="…"; $env:YAHOO_CLIENT_SECRET="…"
$env:YAHOO_REDIRECT_URI="http://localhost:8000/api/yahoo/callback"
cd backend; uvicorn app.main:app --reload
```

Serve the frontend over http (not `file://`, so localStorage + the callback
work), e.g. `python -m http.server 5500` inside `frontend/`, then open
`http://localhost:5500/?api=http://localhost:8000`. Register
`http://localhost:8000/api/yahoo/callback` as a second redirect URI on the
Yahoo app for local testing.

## Notes

- **Read-only**: only the `fspt-r` scope is requested — BoxScore can't modify a
  Yahoo roster.
- **Stateless / no DB**: the server never persists tokens; they sit in the
  user's `localStorage` and refresh automatically. "Disconnect" clears them.
- **Open-redirect safe**: the callback only hands tokens back to origins in
  `YAHOO_ALLOWED_RETURNS`; state is HMAC-signed so it can't be forged.
- **Free tier cold start**: Render's free service sleeps when idle, so the first
  Yahoo action after a while may take ~30s while it wakes.

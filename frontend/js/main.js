// BoxScore frontend — nav, reveals, counters, and the interactive value board.
// (Internal localStorage keys keep their "hoopiq_" prefix so existing saved
//  state/watchlists survive the rename.)
// Live API is only reachable locally; a hosted page loads a bundled data
// snapshot instead. Punt / sort / search / filters all run client-side off the
// per-category z-scores, so the board re-ranks instantly with no refetch.
const IS_LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const API = new URLSearchParams(location.search).get("api")
  || (IS_LOCAL ? "http://127.0.0.1:8000" : null);
const REPO_URL = "https://github.com/YusufUzun03/NBA_stat_analyzer";

const CATS = [
  { k: "pts", l: "PTS" }, { k: "reb", l: "REB" }, { k: "ast", l: "AST" },
  { k: "stl", l: "STL" }, { k: "blk", l: "BLK" }, { k: "tpm", l: "3PM" },
  { k: "fg", l: "FG%" }, { k: "ft", l: "FT%" }, { k: "tov", l: "TOV" },
];
const CAT_KEYS = CATS.map((c) => c.k);
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

// Team logos from ESPN's CDN, keyed by basketball-reference abbreviation
// (a few differ from ESPN's, e.g. BRK->bkn, PHO->phx, NOP->no). Multi-team
// rows ("2TM"/"3TM") aren't in the map, so they gracefully get no logo.
const BR_TO_ESPN = {
  ATL: "atl", BOS: "bos", BRK: "bkn", CHI: "chi", CHO: "cha", CLE: "cle",
  DAL: "dal", DEN: "den", DET: "det", GSW: "gs", HOU: "hou", IND: "ind",
  LAC: "lac", LAL: "lal", MEM: "mem", MIA: "mia", MIL: "mil", MIN: "min",
  NOP: "no", NYK: "ny", OKC: "okc", ORL: "orl", PHI: "phi", PHO: "phx",
  POR: "por", SAC: "sac", SAS: "sa", TOR: "tor", UTA: "utah", WAS: "wsh",
};
const teamLogoURL = (team) => {
  const e = BR_TO_ESPN[String(team || "").toUpperCase()];
  return e ? `https://a.espncdn.com/i/teamlogos/nba/500/${e}.png` : null;
};
// Small inline logo; onerror removes it so a missing logo just disappears.
function teamLogo(team, cls = "") {
  const u = teamLogoURL(team);
  return u ? `<img class="tlogo ${cls}" src="${u}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />` : "";
}

// Accent-insensitive search key: "Jokić" -> "jokic", "Dončić" -> "doncic",
// so users can find players without typing diacritics.
const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
// Coalesce rapid input (search keystrokes) into one render — the board rebuilds
// 400+ rows, so re-running on every keystroke is the main jank source.
const debounce = (fn, ms = 130) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
// Hosted: the available seasons come from data/manifest.json (kept in sync by
// the nightly refresh), so a new season appears automatically. Live backend:
// it can serve any recent season. bootstrapSeasons() may replace this list.
let SEASONS = API
  ? ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"]
  : ["2025-26"]; // fallback until the manifest loads

const DEFAULTS = { season: "2025-26", pool: 156, minMin: 12, punts: [],
  pos: "ALL", team: "ALL", search: "", sortKey: "total", sortDir: "desc", statMode: "z" };

let state = loadState();
let rawPlayers = [];   // current fetched set (full z, no punt applied)

// PWA: register the service worker for offline/installable support.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

/* ---------- watchlist (starred players) ---------- */
const WATCH_KEY = "hoopiq_watchlist";
let watchlist = loadWatchlist();   // Set of player ids
let starredOnly = false;           // board filter toggle (transient)
// A shared link can carry a roster via ?stars=id1,id2 — show the sender's team
// in-memory without clobbering the visitor's saved watchlist (it only persists
// once they actually star/unstar something themselves).
(() => {
  const s = new URLSearchParams(location.search).get("stars");
  if (s) { const ids = s.split(",").filter(Boolean); if (ids.length) watchlist = new Set(ids); }
})();
function loadWatchlist() {
  try { return new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveWatchlist() { localStorage.setItem(WATCH_KEY, JSON.stringify([...watchlist])); }
const isStarred = (id) => watchlist.has(id);
function toggleStar(id) {
  watchlist.has(id) ? watchlist.delete(id) : watchlist.add(id);
  saveWatchlist();
  if (starredOnly && !watchlist.size) starredOnly = false;  // nothing left to show
  render();
  renderPlayerGrid(document.getElementById("player-search")?.value.trim() || "");
  renderMyTeam();
  renderStreamers();
  syncStarChip();
}
function syncStarChip() {
  const chip = document.getElementById("starChip");
  if (!chip) return;
  chip.classList.toggle("active", starredOnly);
  chip.textContent = `★ Starred (${watchlist.size})`;
}

document.addEventListener("DOMContentLoaded", async () => {
  initNav();
  initMobileMenu();
  initScrollSpy();
  initShortcuts();
  initApiLink();
  initReveals();
  initCounters();
  await bootstrapSeasons();   // hosted: pull the season list from the manifest first
  initControls();
  initTools();
  initModal();
  initHistoryTabs();
  renderHistory();   // independent of the season/players data
  load();
});

// Hosted mode only: read data/manifest.json so the season dropdown reflects the
// snapshots that actually exist, and default to the current season. Falls back
// silently to the hardcoded list if the manifest is missing.
async function bootstrapSeasons() {
  if (API) return;
  try {
    const r = await fetch("data/manifest.json", { cache: "no-store" });
    if (!r.ok) return;
    const m = await r.json();
    if (Array.isArray(m.seasons) && m.seasons.length) {
      SEASONS = m.seasons;
      if (!SEASONS.includes(state.season)) state.season = m.current || SEASONS[0];
    }
  } catch {}
}

/* ---------- nav / reveal / counters ---------- */
function initNav() {
  const nav = document.getElementById("nav");
  const toTop = document.getElementById("toTop");
  const prog = document.getElementById("scrollProgress");
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 30);
    if (toTop) toTop.classList.toggle("show", y > 600);
    if (prog) {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      prog.style.width = `${h > 0 ? Math.min(100, (y / h) * 100) : 0}%`;
    }
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  toTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

/* ---- mobile menu (hamburger) ---- */
function initMobileMenu() {
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  const links = document.querySelector(".nav-links");
  if (!nav || !toggle) return;
  const close = () => { nav.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); };
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  links?.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.addEventListener("click", (e) => {
    if (nav.classList.contains("open") && !e.target.closest(".nav")) close();
  });
  window.addEventListener("resize", () => { if (window.innerWidth > 900) close(); });
}

/* ---- keyboard shortcut: "/" jumps to the board search ---- */
function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const el = document.getElementById("search");
    if (el) { e.preventDefault(); el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus(); }
  });
}

/* ---- scroll-spy: highlight the nav link for the section in view ---- */
function initScrollSpy() {
  const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const map = new Map();
  links.forEach((a) => {
    const sec = document.getElementById(a.getAttribute("href").slice(1));
    if (sec) map.set(sec, a);
  });
  if (!map.size) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((l) => { l.classList.remove("active"); l.removeAttribute("aria-current"); });
      const a = map.get(e.target);
      if (a) { a.classList.add("active"); a.setAttribute("aria-current", "true"); }
    });
  }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
  map.forEach((_, sec) => io.observe(sec));
}
function initApiLink() {
  const link = document.getElementById("api-link");
  if (!link) return;
  if (API) { link.href = API + "/docs"; link.textContent = "API"; }
  else { link.href = REPO_URL; link.textContent = "GitHub"; }
}
function initReveals() {
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
    { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}
function initCounters() {
  const run = (el) => {
    const end = +el.dataset.count; let start;
    const step = (ts) => { start ??= ts; const p = Math.min((ts - start) / 1200, 1);
      el.textContent = Math.floor(p * end).toLocaleString("en-US"); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((es, obs) => es.forEach((e) => {
    if (e.isIntersecting) { run(e.target); obs.unobserve(e.target); } }));
  document.querySelectorAll(".hero-stats b[data-count]").forEach((n) => io.observe(n));
}
// Hero visual: a live radar of the current #1's 9-category z profile. The grid
// is drawn once; switching players morphs the shape — each axis grows/shrinks
// to the new value (no slide/fade). Cycles the top 5; caption opens the modal.
let heroRadarTimer = null;
let heroRadarIdx = 0;
let heroVals = null;
let heroRaf = null;
const HERO_SIZE = 360, HERO_C = 180, HERO_MAXR = 126;
const heroAngle = (i) => -Math.PI / 2 + i * (2 * Math.PI / CATS.length);
const heroNorm = (z) => Math.max(0.04, Math.min(1, (z + 3) / 6));
const heroPt = (i, r) => ({ x: HERO_C + r * Math.cos(heroAngle(i)), y: HERO_C + r * Math.sin(heroAngle(i)) });

function heroScaffold() {
  let s = `<svg viewBox="0 0 ${HERO_SIZE} ${HERO_SIZE}" class="hr-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  for (const pct of [0.25, 0.5, 0.75, 1]) {
    const pts = CATS.map((_, i) => { const p = heroPt(i, HERO_MAXR * pct); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; });
    s += `<polygon points="${pts.join(" ")}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
  }
  for (let i = 0; i < CATS.length; i++) {
    const e = heroPt(i, HERO_MAXR);
    s += `<line x1="${HERO_C}" y1="${HERO_C}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
  }
  s += `<polygon class="hr-poly" points="" fill="#ee6730" fill-opacity="0.18" stroke="#ee6730" stroke-width="2.5" stroke-linejoin="round"/>`;
  for (let i = 0; i < CATS.length; i++) s += `<circle class="hr-dot" data-i="${i}" r="3.6" fill="#ff8a4c"/>`;
  CATS.forEach((c, i) => {
    const p = heroPt(i, HERO_MAXR + 20);
    const anc = p.x > HERO_C + 4 ? "start" : p.x < HERO_C - 4 ? "end" : "middle";
    s += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anc}" dominant-baseline="middle" fill="rgba(255,255,255,0.62)" font-size="11" font-family="Inter,sans-serif" font-weight="600">${c.l}</text>`;
  });
  return s + "</svg>";
}
function applyHeroRadar(svg, vals) {
  const poly = svg.querySelector(".hr-poly");
  if (poly) poly.setAttribute("points", vals.map((z, i) => {
    const p = heroPt(i, HERO_MAXR * heroNorm(z)); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" "));
  svg.querySelectorAll(".hr-dot").forEach((d) => {
    const i = +d.dataset.i, p = heroPt(i, HERO_MAXR * heroNorm(vals[i]));
    d.setAttribute("cx", p.x.toFixed(1)); d.setAttribute("cy", p.y.toFixed(1));
  });
}
function tweenHeroRadar(svg, from, to, ms = 700) {
  cancelAnimationFrame(heroRaf);
  const start = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms), e = ease(t);
    heroVals = to.map((v, i) => from[i] + (v - from[i]) * e);
    applyHeroRadar(svg, heroVals);
    if (t < 1) heroRaf = requestAnimationFrame(step);
    else heroVals = to.slice();
  };
  heroRaf = requestAnimationFrame(step);
}
function renderHeroRadar() {
  const wrap = document.getElementById("hero-radar");
  if (!wrap || !rawPlayers.length) return;
  const top = computeBoard().slice(0, 5);
  if (!top.length) return;
  wrap.innerHTML = heroScaffold() + `<button class="hr-cap" id="hr-cap"></button>`;
  const svg = wrap.querySelector(".hr-svg");
  const valsFor = (p) => CAT_KEYS.map((k) => p.z?.[k] ?? 0);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  heroRadarIdx = 0;
  heroVals = CAT_KEYS.map(() => 0);          // start collapsed, then grow into #1
  const show = (idx) => {
    const p = top[idx % top.length], target = valsFor(p);
    if (reduce) { heroVals = target.slice(); applyHeroRadar(svg, heroVals); }
    else tweenHeroRadar(svg, heroVals, target);
    const cap = document.getElementById("hr-cap");
    cap.innerHTML = `<span class="hr-rank">#${p.rank}</span><span class="hr-name">${esc(p.name)}</span><span class="hr-z">${p.total >= 0 ? "+" : ""}${p.total.toFixed(1)} z</span>`;
    cap.onclick = () => { const pl = getPlayer(p.id); if (pl) openModal(pl); };
  };
  show(0);
  clearInterval(heroRadarTimer);
  if (!reduce && top.length > 1) {
    heroRadarTimer = setInterval(() => { heroRadarIdx = (heroRadarIdx + 1) % top.length; show(heroRadarIdx); }, 4200);
  }
}


/* ---------- state persistence ---------- */
function loadState() {
  const s = { ...DEFAULTS };
  try { Object.assign(s, JSON.parse(localStorage.getItem("hoopiq_state") || "{}")); } catch {}
  const q = new URLSearchParams(location.search);
  for (const k of ["season", "pos", "team", "search", "sortKey", "sortDir"])
    if (q.has(k)) s[k] = q.get(k);
  if (q.has("pool")) s.pool = +q.get("pool");
  if (q.has("minMin")) s.minMin = +q.get("minMin");
  if (q.has("punts")) s.punts = q.get("punts").split(",").filter(Boolean);
  // accept any YYYY-YY here; bootstrapSeasons() validates against the manifest
  if (!/^\d{4}-\d{2}$/.test(s.season)) s.season = DEFAULTS.season;
  s.punts = new Set(s.punts);
  return s;
}
function saveState() {
  const plain = { ...state, punts: [...state.punts] };
  localStorage.setItem("hoopiq_state", JSON.stringify(plain));
  const q = new URLSearchParams();
  if (state.season !== DEFAULTS.season) q.set("season", state.season);
  if (state.pool !== DEFAULTS.pool) q.set("pool", state.pool);
  if (state.minMin !== DEFAULTS.minMin) q.set("minMin", state.minMin);
  if (state.punts.size) q.set("punts", [...state.punts].join(","));
  if (state.pos !== "ALL") q.set("pos", state.pos);
  if (state.team !== "ALL") q.set("team", state.team);
  if (state.search) q.set("search", state.search);
  if (state.sortKey !== DEFAULTS.sortKey || state.sortDir !== DEFAULTS.sortDir) {
    q.set("sortKey", state.sortKey); q.set("sortDir", state.sortDir);
  }
  const apiParam = new URLSearchParams(location.search).get("api");
  if (apiParam) q.set("api", apiParam);
  history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
}

/* ---------- controls ---------- */
function initControls() {
  // season
  const season = document.getElementById("season");
  season.innerHTML = SEASONS.map((s) => `<option ${s === state.season ? "selected" : ""}>${s}</option>`).join("");
  season.addEventListener("change", () => { state.season = season.value; load(); });

  // position chips
  const posWrap = document.getElementById("posChips");
  ["ALL", ...POSITIONS].forEach((p) => {
    const b = document.createElement("button");
    b.className = "pos-chip" + (state.pos === p ? " active" : "");
    b.textContent = p;
    b.addEventListener("click", () => {
      state.pos = p;
      posWrap.querySelectorAll(".pos-chip").forEach((c) => c.classList.toggle("active", c.textContent === p));
      render();
    });
    posWrap.appendChild(b);
  });

  // watchlist filter chip (toggles "starred only")
  const starChip = document.createElement("button");
  starChip.id = "starChip";
  starChip.className = "pos-chip star-chip";
  starChip.textContent = `★ Starred (${watchlist.size})`;
  starChip.title = "Show only starred players";
  starChip.addEventListener("click", () => {
    if (!watchlist.size) { starChip.classList.add("nudge"); setTimeout(() => starChip.classList.remove("nudge"), 400); return; }
    starredOnly = !starredOnly;
    render();
    syncStarChip();
  });
  posWrap.appendChild(starChip);

  // punt chips
  const puntWrap = document.getElementById("punts");
  CATS.forEach(({ k, l }) => {
    const b = document.createElement("button");
    b.className = "punt-chip" + (state.punts.has(k) ? " active" : "");
    b.textContent = "Punt " + l;
    b.dataset.k = k;
    b.addEventListener("click", () => {
      state.punts.has(k) ? state.punts.delete(k) : state.punts.add(k);
      b.classList.toggle("active");
      render();
      refreshTools();
      syncPuntPresets();
    });
    puntWrap.appendChild(b);
  });
  renderPuntPresets();

  // search
  const search = document.getElementById("search");
  search.value = state.search;
  const debouncedRender = debounce(render);
  search.addEventListener("input", () => { state.search = search.value.trim(); debouncedRender(); });

  // pool + min minutes (baseline-affecting -> refetch; disabled when hosted)
  bindRange("pool", "poolVal", (v) => { state.pool = v; load(); });
  // MPG is a client-side filter on the snapshot (which now holds every player);
  // only refetch when a live backend is actually computing the baseline.
  bindRange("minMin", "minVal", (v) => {
    state.minMin = v;
    if (API && !usingSnapshot) load(); else { saveState(); render(); }
  });
  if (!API) disablePoolControls();

  document.getElementById("reset").addEventListener("click", () => {
    state = { ...DEFAULTS, punts: new Set() };
    saveState(); location.reload();
  });
  document.getElementById("export").addEventListener("click", exportCsv);
  document.getElementById("share")?.addEventListener("click", shareView);

  // Z-score ⇄ per-game raw stats toggle for the board's category columns
  const sm = document.getElementById("statMode");
  if (sm) {
    sm.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.statMode));
    sm.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn[data-mode]");
      if (!b) return;
      state.statMode = b.dataset.mode;
      sm.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      render();
    });
  }
}
// Pool & min-minutes change the z-score baseline, which needs the live backend.
// On the hosted snapshot they're fixed, so grey them out and explain why.
function disablePoolControls() {
  // Only the pool needs the backend (it changes the z-score baseline); MPG is
  // a live client-side filter on the snapshot, so leave it enabled.
  const tool = document.getElementById("pool")?.closest(".tool");
  if (tool) { tool.classList.add("disabled"); tool.title = "Needs the live backend — the hosted snapshot uses a 156-player baseline."; }
}
function bindRange(id, valId, onCommit) {
  const el = document.getElementById(id), out = document.getElementById(valId);
  el.value = state[id === "minMin" ? "minMin" : "pool"];
  out.textContent = el.value;
  el.addEventListener("input", () => { out.textContent = el.value; });
  el.addEventListener("change", () => onCommit(+el.value)); // refetch only on release
}

/* ---------- data loading ---------- */
async function load() {
  saveState();
  setNote("Loading…");
  setLoadingRow();
  try {
    rawPlayers = await fetchPlayers();
    showDataFreshness();
    if (usingSnapshot) disablePoolControls();   // backend-only; grey out on snapshot
    populateTeams();
    render();
    refreshTools();
    renderLeaders();
    renderPlayerGrid("");
    renderMyTeam();
    renderHeroRadar();
    fetchAdvanced(); // fire-and-forget; populates advancedData for modals
  } catch (err) {
    rawPlayers = [];
    renderEmpty(API
      ? "Couldn't reach the backend. Start it with: uvicorn app.main:app"
      : "Couldn't load the data snapshot.");
  }
}
let usingSnapshot = false;   // true when serving the bundled JSON (no live backend)
async function fetchPlayers() {
  if (API) {
    try {
      const u = `${API}/api/players?limit=600&season=${state.season}&pool=${state.pool}&min_minutes=${state.minMin}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
      if (r.ok) { usingSnapshot = false; return (await r.json()).players; }
    } catch {}
    // backend unreachable (e.g. static server with no uvicorn) → fall back to snapshot
  }
  const r = await fetch(`data/players-${state.season}.json`);
  if (!r.ok) throw new Error(r.status);
  usingSnapshot = true;
  const j = await r.json();
  dataGenerated = j.generated || null;
  return j.players;
}
let dataGenerated = null;
// "today" / "yesterday" / "3 days ago" / a date — for the freshness label.
function relativeDate(iso) {
  if (!iso) return "";
  const then = new Date(iso), now = new Date();
  if (isNaN(then)) return "";
  const days = Math.floor((now.setHours(0,0,0,0) - new Date(then).setHours(0,0,0,0)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function showDataFreshness() {
  const rel = usingSnapshot && dataGenerated ? relativeDate(dataGenerated) : "";
  const el = document.getElementById("data-updated");
  if (el) el.textContent = usingSnapshot && rel ? ` · data updated ${rel}` : (!usingSnapshot ? " · live engine" : "");
  const hu = document.getElementById("hero-updated");
  if (hu && rel) hu.textContent = rel;
}

// Advanced stats — keyed by player id
let advancedData = {};
let advancedLoaded = false;
async function fetchAdvanced() {
  if (advancedLoaded) return;
  try {
    if (API) {
      const r = await fetch(`${API}/api/advanced?season=${state.season}`, { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const rows = await r.json();
        rows.forEach((p) => { advancedData[p.id] = p; });
        advancedLoaded = true; return;
      }
    }
    const r = await fetch(`data/advanced-${state.season}.json`);
    if (r.ok) {
      const j = await r.json();
      advancedData = j.players || {};
      advancedLoaded = true;
    }
  } catch {}
}

/* ---------- compute + render ---------- */
function puntedTotal(p) {
  let t = 0;
  for (const k of CAT_KEYS) if (!state.punts.has(k)) t += p.z?.[k] ?? 0;
  return t;
}
function computeBoard() {
  const board = rawPlayers.map((p) => ({ ...p, total: +puntedTotal(p).toFixed(3) }));
  board.sort((a, b) => b.total - a.total);
  board.forEach((p, i) => (p.rank = i + 1));
  return board;
}
function applyFilters(board) {
  const q = norm(state.search);
  return board.filter((p) => {
    if ((p.min ?? 0) < state.minMin) return false;   // client-side MPG floor (snapshot has all players)
    if (starredOnly && !watchlist.has(p.id)) return false;
    if (state.team !== "ALL" && p.team !== state.team) return false;
    if (state.pos !== "ALL" && !(p.pos || "").toUpperCase().includes(state.pos)) return false;
    if (q && !norm(p.name).includes(q) && !norm(p.team).includes(q)) return false;
    return true;
  });
}
function applySort(rows) {
  const { sortKey, sortDir } = state, dir = sortDir === "asc" ? 1 : -1;
  const val = (p) => {
    if (sortKey === "name") return p.name.toLowerCase();
    if (sortKey === "team") return p.team || "";
    if (sortKey === "pos") return p.pos || "";
    if (sortKey === "gp") return p.gp ?? 0;
    if (sortKey === "total" || sortKey === "rank") return p.total;
    if (state.statMode === "raw") return p.stats?.[RAW_MAP[sortKey]] ?? -99; // category raw
    return p.z?.[sortKey] ?? -99; // category z
  };
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

function render() {
  if (!rawPlayers.length) return;
  saveState();
  const board = computeBoard();
  const rows = applySort(applyFilters(board));

  buildHead();
  const tbody = document.querySelector("#rankTable tbody");
  tbody.innerHTML = "";

  if (!rows.length) {
    const filtered = state.search || state.team !== "ALL" || state.pos !== "ALL" || starredOnly;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 16;
    td.className = "board-empty";
    td.innerHTML = `<div class="be-ic">🔍</div>
      <p>No players match your filters.</p>
      ${filtered ? `<button class="btn btn-ghost" id="be-clear" type="button">Clear filters</button>` : ""}`;
    tr.appendChild(td);
    tbody.appendChild(tr);
    td.querySelector("#be-clear")?.addEventListener("click", clearBoardFilters);
    setNote(`0 of ${board.length} players · filters active`);
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((p) => frag.appendChild(rowEl(p)));
  tbody.appendChild(frag);

  const puntTxt = state.punts.size ? ` · punting ${[...state.punts].map((k) => k.toUpperCase()).join(", ")}` : "";
  const src = usingSnapshot ? "bundled snapshot" : "live engine";
  const modeTxt = state.statMode === "raw" ? " · per-game stats" : "";
  setNote(`${rows.length} of ${board.length} players · ${src} · ${state.season} · pool ${state.pool} · ≥${state.minMin} MPG${puntTxt}${modeTxt}`);
}

function clearBoardFilters() {
  state.search = ""; state.team = "ALL"; state.pos = "ALL"; starredOnly = false;
  const s = document.getElementById("search"); if (s) s.value = "";
  const t = document.getElementById("team"); if (t) t.value = "ALL";
  document.querySelectorAll("#posChips .pos-chip").forEach((c) =>
    c.classList.toggle("active", c.textContent === "ALL"));
  syncStarChip();
  render();
}

function buildHead() {
  const cols = [
    { key: "rank", lbl: "#", cls: "l" },
    { key: "name", lbl: "Player", cls: "l" },
    { key: "pos", lbl: "Pos", cls: "l" },
    { key: "team", lbl: "Tm", cls: "l" },
    { key: "gp", lbl: "GP" },
    { key: "total", lbl: "Total" },
    ...CATS.map((c) => ({ key: c.k, lbl: c.l, z: true })),
    { key: "cmp", lbl: "⊕", cls: "c-cmp-h", noSort: true },
  ];
  const thead = document.querySelector("#rankTable thead");
  const tr = document.createElement("tr");
  cols.forEach((c) => {
    const th = document.createElement("th");
    th.className = (c.cls || "") + (c.z && state.punts.has(c.key) ? " punted" : "");
    const active = state.sortKey === c.key || (c.key === "rank" && state.sortKey === "total");
    th.innerHTML = c.lbl + (!c.noSort && active ? `<span class="arr">${state.sortDir === "asc" ? "▲" : "▼"}</span>` : "");
    if (!c.noSort) {
      th.addEventListener("click", () => {
        const key = c.key === "rank" ? "total" : c.key;
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = key === "name" || key === "team" || key === "pos" ? "asc" : "desc"; }
        render();
      });
    } else {
      th.style.cursor = "default";
      th.title = "Add to compare";
    }
    tr.appendChild(th);
  });
  thead.innerHTML = "";
  thead.appendChild(tr);
}

function rowEl(p) {
  const tr = document.createElement("tr");
  if (p.rank === 1) tr.className = "top1";
  const inCmp = compareList.includes(p.id);
  tr.innerHTML =
    `<td class="l c-rk">${p.rank}${tierDot(p.total)}</td>` +
    `<td class="l c-name"><button class="star-btn${isStarred(p.id) ? " on" : ""}" data-star="${esc(p.id)}" title="${isStarred(p.id) ? "Remove from watchlist" : "Add to watchlist"}">${isStarred(p.id) ? "★" : "☆"}</button><span class="pname" data-id="${esc(p.id)}" style="cursor:pointer" title="View details">${esc(p.name)}</span></td>` +
    `<td class="l c-pos">${esc(p.pos || "")}</td>` +
    `<td class="l c-team"><span class="tm-link" data-tm="${esc(p.team)}" title="Team page">${teamLogo(p.team)}${esc(p.team || "")}</span></td>` +
    `<td class="c-gp">${p.gp ?? "—"}</td>` +
    `<td class="c-total">${p.total.toFixed(2)}</td>` +
    CATS.map((c) => {
      const z = p.z?.[c.k];
      const punted = state.punts.has(c.k);
      const bg = punted || z == null ? "" : `background:${heat(z)}`;
      // raw mode shows the real per-game number; heat colour still reflects z
      const txt = state.statMode === "raw"
        ? RAW_FMT(c.k, p.stats?.[RAW_MAP[c.k]])
        : (z == null ? "—" : z.toFixed(2));
      return `<td class="z${punted ? " punted" : ""}" style="${bg}">${txt}</td>`;
    }).join("") +
    `<td class="c-cmp"><button class="cmp-btn${inCmp ? " in-cmp" : ""}" data-id="${esc(p.id)}" title="${inCmp ? "Remove from compare" : "Add to compare"}">⊕</button></td>`;
  return tr;
}

// z -> green (good) / red (bad) cell tint
function heat(z) {
  const v = Math.max(-2, Math.min(3, z));
  if (v >= 0) return `rgba(68,208,123,${(0.1 + 0.5 * (v / 3)).toFixed(3)})`;
  return `rgba(255,92,108,${(0.1 + 0.5 * (-v / 2)).toFixed(3)})`;
}

/* ---------- teams dropdown ---------- */
function populateTeams() {
  const teams = [...new Set(rawPlayers.map((p) => p.team).filter(Boolean))].sort();
  const sel = document.getElementById("team");
  sel.innerHTML = `<option value="ALL">All</option>` +
    teams.map((t) => `<option ${t === state.team ? "selected" : ""}>${t}</option>`).join("");
  if (!teams.includes(state.team)) state.team = "ALL";
  sel.onchange = () => { state.team = sel.value; render(); };
}

/* ---------- misc ui ---------- */
function setNote(txt) {
  const n = document.getElementById("board-note");
  n.className = "board-note"; n.textContent = txt;
}
function setLoadingRow() {
  document.querySelector("#rankTable tbody").innerHTML = `<tr><td class="board-loading">Loading rankings…</td></tr>`;
}
function renderEmpty(msg) {
  document.querySelector("#rankTable thead").innerHTML = "";
  document.querySelector("#rankTable tbody").innerHTML = `<tr><td class="board-loading">${esc(msg)}</td></tr>`;
  setNote("");
}
function exportCsv() {
  if (!rawPlayers.length) return;
  const rows = applySort(applyFilters(computeBoard()));
  const head = ["rank", "name", "pos", "team", "gp", "total", ...CAT_KEYS];
  const lines = [head.join(",")];
  rows.forEach((p) => lines.push([p.rank, `"${p.name}"`, p.pos, p.team, p.gp, p.total,
    ...CAT_KEYS.map((k) => (p.z?.[k] ?? "").toString())].join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `boxscore-${state.season}${state.punts.size ? "-punt-" + [...state.punts].join("-") : ""}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ============================ PHASE 2 TOOLS ============================ */
const getPlayer = (id) => rawPlayers.find((p) => p.id === id);

function initTools() {
  attachAC(document.querySelector('.ac[data-ac="give"]'), (p) => addTrade("give", p.id));
  attachAC(document.querySelector('.ac[data-ac="get"]'), (p) => addTrade("get", p.id));
  attachAC(document.querySelector('.ac[data-ac="punt"]'), (p) => { puntFitId = p.id; renderPuntFit(); });
  initSchedule();
  initStreamers();
  initMatchup();
  initTiers();
  initImportModal();
  document.getElementById("importRosterBtn")?.addEventListener("click", openImport);
  // Phase 3: event delegation for player modal + compare buttons
  document.getElementById("rankTable").addEventListener("click", (e) => {
    const starBtn = e.target.closest(".star-btn[data-star]");
    if (starBtn) { toggleStar(starBtn.dataset.star); return; }
    const tmLink = e.target.closest(".tm-link[data-tm]");
    if (tmLink) { openTeamModal(tmLink.dataset.tm); return; }
    const nameCell = e.target.closest(".pname[data-id]");
    if (nameCell) { const p = getPlayer(nameCell.dataset.id); if (p) { openModal(p); return; } }
    const cmpBtn = e.target.closest(".cmp-btn[data-id]");
    if (cmpBtn) toggleCompare(cmpBtn.dataset.id);
  });
  // Phase 4: players section search
  const psearch = document.getElementById("player-search");
  if (psearch) {
    const debouncedGrid = debounce((q) => renderPlayerGrid(q));
    psearch.addEventListener("input", () => debouncedGrid(psearch.value.trim()));
  }
}
function refreshTools() { renderTradeLists(); renderTrade(); renderPuntFit(); renderPositions(); renderStreamers(); renderTiers(); }

/* ---- NBA history hub (champions, awards, All-NBA, leaders, HOF, standings) ---- */
let historyData = null, standingsData = null, playoffsData = null, allstarData = null;
let histTab = "champions";
let histAwardKey = "mvp";
let histChampsAll = false, histHofAll = false, histAllNbaAll = false;
let histStandingsSeason = null, histPoSeason = null, histAsSeason = null;
async function loadHistory() {
  if (historyData) return historyData;
  try { const r = await fetch("data/history.json"); if (r.ok) historyData = await r.json(); } catch {}
  return historyData;
}
async function loadStandings() {
  if (standingsData) return standingsData;
  try { const r = await fetch("data/standings.json"); if (r.ok) standingsData = await r.json(); } catch {}
  return standingsData;
}
async function loadPlayoffs() {
  if (playoffsData) return playoffsData;
  try { const r = await fetch("data/playoffs.json"); if (r.ok) playoffsData = await r.json(); } catch {}
  return playoffsData;
}
async function loadAllStar() {
  if (allstarData) return allstarData;
  try { const r = await fetch("data/allstar.json"); if (r.ok) allstarData = await r.json(); } catch {}
  return allstarData;
}
const PO_STAGES = ["First Round", "Conf Semifinals", "Conf Finals", "Finals"];
function initHistoryTabs() {
  const tabs = document.getElementById("hist-tabs");
  tabs?.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn[data-tab]");
    if (!b) return;
    histTab = b.dataset.tab;
    tabs.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderHistory();
  });
}
const histRows = (arr) => arr.join("");
const histRow = (season, main, sub) =>
  `<div class="hist-row"><span class="hist-season">${esc(season)}</span><span class="hist-main">${main}</span><span class="hist-sub">${sub}</span></div>`;
const moreBtn = (id, expanded, total) =>
  `<button class="btn btn-ghost hist-more" id="${id}" type="button">${expanded ? "Show less" : "Show all " + total}</button>`;

async function renderHistory() {
  const body = document.getElementById("hist-body");
  if (!body) return;
  const h = await loadHistory();
  if (!h) { body.innerHTML = '<div class="board-loading">History unavailable.</div>'; return; }

  if (histTab === "champions") {
    const champs = histChampsAll ? h.champions : h.champions.slice(0, 20);
    body.innerHTML = `<div class="hist-list wide">` + histRows(champs.map((c) =>
      histRow(c.season, `${teamLogo(c.champion_abbr)}<b>${esc(c.champion)}</b>`,
        `def. ${esc(c.runner_up)}${c.finals_mvp ? ` · FMVP ${esc(c.finals_mvp)}` : ""}`))) +
      `</div>` + (h.champions.length > 20 ? moreBtn("h-more", histChampsAll, h.champions.length + " seasons") : "");
    body.querySelector("#h-more")?.addEventListener("click", () => { histChampsAll = !histChampsAll; renderHistory(); });

  } else if (histTab === "awards") {
    const keys = Object.keys(h.awards || {});
    if (!keys.includes(histAwardKey)) histAwardKey = keys[0];
    const list = (h.awards || {})[histAwardKey] || [];
    const label = (h.award_labels || {})[histAwardKey] || histAwardKey.toUpperCase();
    body.innerHTML =
      `<div class="seg hist-sub-seg">` + keys.map((k) =>
        `<button class="seg-btn${k === histAwardKey ? " active" : ""}" data-aw="${k}" type="button">${k.toUpperCase()}</button>`).join("") + `</div>` +
      `<div class="hist-aw-label">${esc(label)}</div><div class="hist-list wide">` +
      histRows(list.map((w) => histRow(w.season, `<b>${esc(w.player)}</b>`, esc(w.team || "")))) + `</div>`;
    body.querySelectorAll(".hist-sub-seg .seg-btn").forEach((b) =>
      b.addEventListener("click", () => { histAwardKey = b.dataset.aw; renderHistory(); }));

  } else if (histTab === "allnba") {
    const all = h.all_nba || [];
    const shown = histAllNbaAll ? all : all.slice(0, 18);
    body.innerHTML = `<div class="hist-list wide">` + histRows(shown.map((t) =>
      histRow(t.season, `<b>All-NBA ${esc(t.team)}</b>`, t.players.map(esc).join(" · ")))) +
      `</div>` + (all.length > 18 ? moreBtn("h-more", histAllNbaAll, all.length + " teams") : "");
    body.querySelector("#h-more")?.addEventListener("click", () => { histAllNbaAll = !histAllNbaAll; renderHistory(); });

  } else if (histTab === "leaders") {
    const L = h.leaders || {};
    body.innerHTML = `<div class="hist-lead-grid">` + Object.keys(L).map((k) => `
      <div class="ldr-card">
        <div class="ldr-cat">${esc(L[k].label)} <small>all-time</small></div>
        ${L[k].rows.map((r, i) => `<div class="ldr-row"><span class="ldr-rk">${i + 1}</span><span class="ldr-name">${esc(r.player)}</span><span class="ldr-val">${esc((+r.value).toLocaleString("en-US"))}</span></div>`).join("")}
      </div>`).join("") + `</div>`;

  } else if (histTab === "hof") {
    const hof = h.hof || [];
    const shown = histHofAll ? hof : hof.slice(0, 30);
    body.innerHTML = `<div class="hof-grid">` + shown.map((p) =>
      `<div class="hof-card"><b>${esc(p.name)}</b><span>Class of ${esc(p.year)}</span></div>`).join("") +
      `</div>` + (hof.length > 30 ? moreBtn("h-more", histHofAll, hof.length + " inductees") : "");
    body.querySelector("#h-more")?.addEventListener("click", () => { histHofAll = !histHofAll; renderHistory(); });

  } else if (histTab === "standings") {
    body.innerHTML = `<div class="board-loading">Loading standings…</div>`;
    const s = await loadStandings();
    if (!s) { body.innerHTML = '<div class="board-loading">Standings unavailable.</div>'; return; }
    const seasons = Object.keys(s.seasons);
    if (!histStandingsSeason || !s.seasons[histStandingsSeason])
      histStandingsSeason = s.seasons[state.season] ? state.season : seasons[0];
    const sel = s.seasons[histStandingsSeason] || { East: [], West: [] };
    const confTable = (name, rows) => `<div class="stand-conf"><div class="stand-h">${name}</div>` +
      rows.map((r) => `<div class="stand-row${+r.seed <= 8 ? " playoff" : ""}" data-tm="${esc(r.abbr)}" role="button" tabindex="0">
        <span class="stand-seed">${esc(r.seed)}</span>
        <span class="stand-team">${teamLogo(r.abbr)}${esc(r.team)}</span>
        <span class="stand-rec">${esc(r.w)}–${esc(r.l)}</span>
        <span class="stand-pct">${esc(r.pct)}</span></div>`).join("") + `</div>`;
    body.innerHTML =
      `<div class="stand-bar"><label>Season</label><select id="stand-season">` +
        seasons.map((yr) => `<option ${yr === histStandingsSeason ? "selected" : ""}>${yr}</option>`).join("") +
      `</select><span class="hist-aw-label" style="margin:0">Top 8 make the playoffs</span></div>` +
      `<div class="stand-grid">${confTable("Eastern", sel.East)}${confTable("Western", sel.West)}</div>`;
    document.getElementById("stand-season")?.addEventListener("change", (e) => { histStandingsSeason = e.target.value; renderHistory(); });
    body.querySelectorAll(".stand-row[data-tm]").forEach((el) =>
      el.addEventListener("click", () => openTeamModal(el.dataset.tm)));

  } else if (histTab === "playoffs") {
    body.innerHTML = `<div class="board-loading">Loading bracket…</div>`;
    const p = await loadPlayoffs();
    if (!p) { body.innerHTML = '<div class="board-loading">Playoffs unavailable.</div>'; return; }
    const seasons = Object.keys(p.seasons);
    if (!histPoSeason || !p.seasons[histPoSeason])
      histPoSeason = p.seasons[state.season] ? state.season : seasons[0];
    const series = p.seasons[histPoSeason] || [];
    const seriesEl = (s) => {
      const ws = s.score.split("-")[0];
      return `<div class="po-series">
        <div class="po-team win">${teamLogo(s.winner_abbr)}<span>${esc(s.winner)}</span><b>${esc(ws)}</b></div>
        <div class="po-team">${teamLogo(s.loser_abbr)}<span>${esc(s.loser)}</span><b>${esc(s.score.split("-")[1])}</b></div>
      </div>`;
    };
    const col = (stage) => {
      const inStage = series.filter((s) => s.stage === stage)
        .sort((a, b) => (a.conf > b.conf ? 1 : -1));
      return `<div class="po-col"><div class="po-col-h">${esc(stage)}</div>${inStage.map(seriesEl).join("")}</div>`;
    };
    body.innerHTML =
      `<div class="stand-bar"><label>Season</label><select id="po-season">` +
        seasons.map((yr) => `<option ${yr === histPoSeason ? "selected" : ""}>${yr}</option>`).join("") +
      `</select></div>` +
      `<div class="po-bracket">${PO_STAGES.map(col).join("")}</div>`;
    document.getElementById("po-season")?.addEventListener("change", (e) => { histPoSeason = e.target.value; renderHistory(); });

  } else if (histTab === "allstar") {
    body.innerHTML = `<div class="board-loading">Loading rosters…</div>`;
    const a = await loadAllStar();
    if (!a) { body.innerHTML = '<div class="board-loading">All-Star data unavailable.</div>'; return; }
    const seasons = Object.keys(a.seasons);
    if (!histAsSeason || !a.seasons[histAsSeason])
      histAsSeason = a.seasons[state.season] ? state.season : seasons[0];
    const rosters = a.seasons[histAsSeason] || [];
    body.innerHTML =
      `<div class="stand-bar"><label>Season</label><select id="as-season">` +
        seasons.map((yr) => `<option ${yr === histAsSeason ? "selected" : ""}>${yr}</option>`).join("") +
      `</select></div>` +
      `<div class="as-grid">` + rosters.map((r) => `
        <div class="as-card">
          <div class="as-team">${esc(r.name)} <small>${r.players.length}</small></div>
          <div class="as-players">${r.players.map((p) => `<span>${esc(p)}</span>`).join("")}</div>
        </div>`).join("") + `</div>`;
    document.getElementById("as-season")?.addEventListener("change", (e) => { histAsSeason = e.target.value; renderHistory(); });
  }
}

/* ---- team page (modal, built from existing data) ---- */
let TEAM_NAMES = null;
function teamNames() {
  if (TEAM_NAMES) return TEAM_NAMES;
  TEAM_NAMES = {};
  if (standingsData) for (const yr in standingsData.seasons)
    for (const conf of ["East", "West"])
      (standingsData.seasons[yr][conf] || []).forEach((r) => { if (r.abbr) TEAM_NAMES[r.abbr] = r.team; });
  return TEAM_NAMES;
}
function teamWinSparkline(recs) {
  const pts = recs.map((r) => parseFloat(r.pct)).filter((v) => !isNaN(v));
  if (pts.length < 2) return "";
  const W = 560, H = 70, pad = 6, w = W - pad * 2, h = H - pad * 2;
  const x = (i) => pad + (i / (pts.length - 1)) * w;
  const y = (v) => pad + h - v * h;
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `M${x(0).toFixed(1)},${H - pad} ` + pts.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + ` L${x(pts.length - 1).toFixed(1)},${H - pad} Z`;
  const ref = y(0.5).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${pad}" y1="${ref}" x2="${W - pad}" y2="${ref}" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 3"/>` +
    `<path d="${area}" fill="rgba(238,103,48,.12)"/>` +
    `<path d="${line}" fill="none" stroke="#ee6730" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1]).toFixed(1)}" r="3" fill="#ee6730"/></svg>`;
}
async function openTeamModal(abbr) {
  abbr = (abbr || "").toUpperCase();
  if (!abbr || !teamLogoURL(abbr)) return;     // skip multi-team / unknown
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  if (!overlay || !content) return;
  content.innerHTML = '<div class="career-loading">Loading team…</div>';
  overlay.classList.add("open"); overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  lastFocused = document.activeElement;

  const [st, hi, po] = await Promise.all([loadStandings(), loadHistory(), loadPlayoffs()]);
  const name = teamNames()[abbr] || abbr;
  const exitFor = (season) => {
    const mine = ((po?.seasons || {})[season] || []).filter((s) => s.winner_abbr === abbr || s.loser_abbr === abbr);
    if (!mine.length) return "—";
    const lost = mine.find((s) => s.loser_abbr === abbr);
    if (!lost) return mine.some((s) => s.stage === "Finals" && s.winner_abbr === abbr) ? "🏆 Champion" : "Won " + mine[mine.length - 1].stage;
    return "Lost " + lost.stage;
  };
  const recs = [];
  if (st) for (const yr of Object.keys(st.seasons))
    for (const conf of ["East", "West"]) {
      const r = (st.seasons[yr][conf] || []).find((x) => x.abbr === abbr);
      if (r) recs.push({ season: yr, conf, seed: r.seed, w: r.w, l: r.l, pct: r.pct, po: exitFor(yr) });
    }
  // recs are ascending (oldest first) → sparkline before we reverse for the table
  const spark = teamWinSparkline(recs);
  recs.reverse();
  const titles = (hi?.champions || []).filter((c) => c.champion_abbr === abbr).map((c) => c.season);
  const runners = (hi?.champions || []).filter((c) => c.runner_up_abbr === abbr).map((c) => c.season);
  const roster = rawPlayers.filter((p) => (p.team || "").toUpperCase() === abbr)
    .map((p) => ({ ...p, t: fullZTotal(p) })).sort((a, b) => b.t - a.t);

  const poClass = (t) => t.startsWith("🏆") ? "tm-po-champ" : t.startsWith("Lost") ? "tm-po-out" : t === "—" ? "tm-po-none" : "tm-po-win";
  const recRows = recs.map((r) => `<tr>
      <td class="cat-lbl">${esc(r.season)}</td><td>${esc(r.conf)} ${esc(r.seed)}</td>
      <td>${esc(r.w)}–${esc(r.l)}</td><td>${esc(r.pct)}</td>
      <td class="${poClass(r.po)}">${esc(r.po)}</td></tr>`).join("");
  const rosterHtml = roster.length ? `<div class="tm-sec-h">Current roster <small>${state.season}</small></div>
    <div class="tm-roster">${roster.map((p) => `<button class="tm-pl" data-id="${esc(p.id)}">
      <span>${esc(p.name)}</span><span class="tm-pl-meta">${esc(p.pos || "")} · <b class="${p.t >= 0 ? "pos-good" : "pos-bad"}">${p.t >= 0 ? "+" : ""}${p.t.toFixed(1)}</b></span></button>`).join("")}</div>` : "";

  content.innerHTML = `
    <div class="modal-header modal-header-photo">
      <div class="tm-logo">${teamLogo(abbr) || ""}</div>
      <div class="modal-head-info">
        <div class="modal-name">${esc(name)}</div>
        <div class="modal-meta">${titles.length ? `🏆 ${titles.length} title${titles.length > 1 ? "s" : ""}` : "No titles since 2000"}${runners.length ? ` · ${runners.length} Finals runner-up` : ""}</div>
        ${titles.length ? `<div class="tm-titles">Champions: ${titles.map(esc).join(", ")}</div>` : ""}
      </div>
    </div>
    ${rosterHtml}
    <div class="tm-sec-h">Season by season <small>since 2000-01</small></div>
    ${spark ? `<div class="tm-spark">${spark}<span class="tm-spark-lbl">win % by season</span></div>` : ""}
    <div class="career-table-wrap"><table class="career-tbl"><thead><tr>
      <th class="cat-lbl">Season</th><th>Conf · Seed</th><th>W–L</th><th>Win%</th><th>Playoffs</th></tr></thead>
      <tbody>${recRows || '<tr><td colspan="5" class="cat-lbl">No records.</td></tr>'}</tbody></table></div>`;

  content.querySelectorAll(".tm-pl[data-id]").forEach((b) =>
    b.addEventListener("click", () => { const p = getPlayer(b.dataset.id); if (p) openModal(p); }));
}

/* ---- draft tiers (snake-draft cheat sheet) ---- */
let tiersPool = 156;
function initTiers() {
  const slider = document.getElementById("tiers-pool");
  const val = document.getElementById("tiersPoolVal");
  if (slider) {
    slider.value = tiersPool; if (val) val.textContent = tiersPool;
    slider.addEventListener("input", () => {
      tiersPool = +slider.value; if (val) val.textContent = tiersPool; renderTiers();
    });
  }
  document.getElementById("tiers-print")?.addEventListener("click", () => window.print());
}
const TIER_ORDER = [
  { label: "Elite",   cls: "tier-elite",   min: 4.5,        desc: "z ≥ 4.5" },
  { label: "Star",    cls: "tier-star",    min: 2.5,        desc: "2.5 – 4.5" },
  { label: "Starter", cls: "tier-starter", min: 0.5,        desc: "0.5 – 2.5" },
  { label: "Deep",    cls: "tier-border",  min: -0.5,       desc: "−0.5 – 0.5" },
  { label: "Below",   cls: "tier-below",   min: -Infinity,  desc: "< −0.5" },
];
function renderTiers() {
  const wrap = document.getElementById("tiers-wrap");
  if (!wrap || !rawPlayers.length) return;
  const board = computeBoard().slice(0, tiersPool);
  const bands = TIER_ORDER.map((t) => ({ ...t, players: [] }));
  board.forEach((p) => bands.find((b) => p.total >= b.min).players.push(p));
  const puntTxt = state.punts.size ? ` · punting ${[...state.punts].map((k) => k.toUpperCase()).join(", ")}` : "";
  wrap.innerHTML = bands.filter((b) => b.players.length).map((b) => `
    <div class="tier-band">
      <div class="tier-band-head">
        <span class="tier-badge ${b.cls}">${b.label}</span>
        <span class="tier-band-meta">${b.players.length} players · ${b.desc}</span>
      </div>
      <div class="tier-chips">
        ${b.players.map((p) => `
          <button class="tier-chip" data-id="${esc(p.id)}" title="View ${esc(p.name)}">
            ${avatarHTML(p, "tier-photo")}
            <span class="tc-info">
              <span class="tc-name">${esc(p.name)}</span>
              <span class="tc-sub">#${p.rank} · ${teamLogo(p.team)}${esc(p.team || "—")} · ${esc(p.pos || "—")}</span>
            </span>
            <span class="tc-z ${p.total >= 0 ? "pos-good" : "pos-bad"}">${p.total >= 0 ? "+" : ""}${p.total.toFixed(1)}</span>
          </button>`).join("")}
      </div>
    </div>`).join("") +
    `<div class="board-note" style="padding-top:12px">Top ${board.length} players by total z${puntTxt}</div>`;
  wrap.querySelectorAll(".tier-chip[data-id]").forEach((el) =>
    el.addEventListener("click", () => { const p = getPlayer(el.dataset.id); if (p) openModal(p); }));
}

/* ---- best streamers (schedule-weighted pickups) ---- */
let streamMinGames = 3;
let streamExcludeMine = true;
function initStreamers() {
  const seg = document.getElementById("stream-mingames");
  seg?.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn[data-min]");
    if (!b) return;
    streamMinGames = +b.dataset.min;
    seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderStreamers();
  });
  document.getElementById("stream-exclude")?.addEventListener("change", (e) => {
    streamExcludeMine = e.target.checked;
    renderStreamers();
  });
}
function renderStreamers() {
  const grid = document.getElementById("stream-grid");
  if (!grid || !rawPlayers.length) return;
  if (!scheduleGames.length) {
    grid.innerHTML = `<div class="board-loading">Schedule not loaded yet.</div>`;
    return;
  }
  const anchor = document.getElementById("wk-date")?.value || "2026-01-12";
  const wk = gamesPerWeek(scheduleGames, anchor);
  const gmap = {};
  wk.teams.forEach((t) => (gmap[t.team] = t.games));
  const weekEl = document.getElementById("stream-week");
  if (weekEl) weekEl.textContent = `${wk.weekStart} → ${wk.weekEnd}`;

  const rows = computeBoard()
    .map((p) => ({ p, g: gmap[p.team] || 0 }))
    .filter((x) => x.g >= streamMinGames)
    .filter((x) => !(streamExcludeMine && watchlist.has(x.p.id)))
    .map((x) => ({ ...x, score: x.g * x.p.total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  if (!rows.length) {
    grid.innerHTML = `<div class="board-loading">No players play ${streamMinGames}+ games this week (offseason or break).</div>`;
    return;
  }
  grid.innerHTML = rows.map(({ p, g }) => `
    <div class="stream-card" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="View ${esc(p.name)}">
      <button class="star-btn sc-star${isStarred(p.id) ? " on" : ""}" data-star="${esc(p.id)}" title="${isStarred(p.id) ? "Remove from watchlist" : "Add to watchlist"}">${isStarred(p.id) ? "★" : "☆"}</button>
      <div class="sg-games"><b>${g}</b><span>GP</span></div>
      ${avatarHTML(p, "pc-avatar")}
      <div class="pc-info">
        <div class="pc-name">${esc(p.name)}</div>
        <div class="pc-meta">${teamLogo(p.team)}${esc(p.team || "—")} · ${esc(p.pos || "—")} · #${p.rank}</div>
      </div>
      <div class="sg-val ${p.total >= 0 ? "pos-good" : "pos-bad"}">${p.total >= 0 ? "+" : ""}${p.total.toFixed(1)}<span>z</span></div>
    </div>`).join("");
  grid.querySelectorAll(".stream-card[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const star = e.target.closest(".star-btn[data-star]");
      if (star) { e.stopPropagation(); toggleStar(star.dataset.star); return; }
      const p = getPlayer(el.dataset.id); if (p) openModal(p);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const p = getPlayer(el.dataset.id); if (p) openModal(p); }
    });
  });
}

/* ---- positional rankings ---- */
const POS_META = [
  { k: "PG", l: "Point Guards" },
  { k: "SG", l: "Shooting Guards" },
  { k: "SF", l: "Small Forwards" },
  { k: "PF", l: "Power Forwards" },
  { k: "C",  l: "Centers" },
];
function renderPositions() {
  const grid = document.getElementById("pos-rank-grid");
  if (!grid || !rawPlayers.length) return;
  const board = computeBoard();        // punt-aware .total + overall .rank
  grid.innerHTML = POS_META.map((pos) => {
    const all = board.filter((p) => (p.pos || "").toUpperCase() === pos.k);
    const list = all.slice(0, 12);
    return `<div class="pr-card">
      <div class="pr-head"><span class="pr-pos">${pos.k}</span>${pos.l}<span class="pr-ct">${all.length}</span></div>
      ${list.map((p, i) => `
        <div class="pr-row">
          <span class="pr-rk">${i + 1}</span>
          <span class="pr-name" data-id="${esc(p.id)}" title="View details">${esc(p.name)}</span>
          <span class="pr-team">${teamLogo(p.team)}${esc(p.team || "")}</span>
          <span class="pr-tot ${p.total >= 0 ? "pos-good" : "pos-bad"}">${p.total >= 0 ? "+" : ""}${p.total.toFixed(1)}</span>
          <span class="pr-ov" title="Overall rank">#${p.rank}</span>
        </div>`).join("")}
    </div>`;
  }).join("");
  grid.querySelectorAll(".pr-name[data-id]").forEach((el) =>
    el.addEventListener("click", () => { const p = getPlayer(el.dataset.id); if (p) openModal(p); }));
}

/* ---- reusable autocomplete ---- */
function attachAC(acEl, onPick) {
  if (!acEl) return;
  const input = acEl.querySelector("input");
  const menu = acEl.querySelector(".ac-menu");
  const close = () => { menu.classList.remove("open"); menu.innerHTML = ""; };
  input.addEventListener("input", () => {
    const q = norm(input.value.trim());
    if (!q) return close();
    const hits = rawPlayers.filter((p) => norm(p.name).includes(q)).slice(0, 8);
    if (!hits.length) return close();
    menu.innerHTML = hits.map((p) =>
      `<div class="ac-item" data-id="${esc(p.id)}"><span>${esc(p.name)}</span><span class="meta">${esc(p.team || "")} ${esc(p.pos || "")}</span></div>`).join("");
    menu.classList.add("open");
    menu.querySelectorAll(".ac-item").forEach((it) =>
      it.addEventListener("mousedown", (e) => { e.preventDefault(); const p = getPlayer(it.dataset.id); if (p) onPick(p); input.value = ""; close(); }));
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = menu.querySelector(".ac-item"); if (f) f.dispatchEvent(new MouseEvent("mousedown")); } });
}

/* ---- trade analyzer ---- */
const tradeSel = { give: [], get: [] };
function addTrade(side, id) {
  if (tradeSel.give.includes(id) || tradeSel.get.includes(id)) return;
  tradeSel[side].push(id); renderTradeLists(); renderTrade();
}
function removeTrade(side, id) {
  tradeSel[side] = tradeSel[side].filter((x) => x !== id); renderTradeLists(); renderTrade();
}
function renderTradeLists() {
  for (const side of ["give", "get"]) {
    const el = document.getElementById(side + "-list");
    if (!el) continue;
    el.innerHTML = tradeSel[side].map((id) => {
      const p = getPlayer(id);
      if (!p) return "";
      return `<div class="tl-item">${avatarHTML(p, "tl-photo")}<span class="tl-name">${esc(p.name)}</span><span class="tl-end"><span class="tot">${puntedTotal(p).toFixed(1)}</span> <button data-side="${side}" data-id="${esc(id)}">×</button></span></div>`;
    }).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => removeTrade(b.dataset.side, b.dataset.id)));
  }
}
function sideSums(ids) {
  const sums = {}; CAT_KEYS.forEach((k) => (sums[k] = 0));
  ids.forEach((id) => { const p = getPlayer(id); if (p) CAT_KEYS.forEach((k) => { if (!state.punts.has(k)) sums[k] += p.z?.[k] ?? 0; }); });
  let total = 0; CAT_KEYS.forEach((k) => { if (!state.punts.has(k)) total += sums[k]; });
  return { sums, total };
}
function gradeTrade(net) {
  const table = [[4, "A+", "Huge win for the receiving side."], [2.5, "A", "Clear win for the receiving side."],
    [1.2, "B+", "Solid win for the receiving side."], [0.4, "B", "Slight win for the receiving side."],
    [-0.4, "C", "Fair / even trade."], [-1.2, "C-", "Slight loss for the receiving side."],
    [-2.5, "D", "Clear loss for the receiving side."]];
  for (const [th, g, v] of table) if (net >= th) return { grade: g, verdict: v };
  return { grade: "F", verdict: "Big loss for the receiving side." };
}
function renderTrade() {
  const box = document.getElementById("trade-result");
  if (!box) return;
  if (!tradeSel.give.length || !tradeSel.get.length) {
    box.innerHTML = '<div class="trade-empty">Add players to both sides to grade the deal.</div>'; return;
  }
  const g = sideSums(tradeSel.give), r = sideSums(tradeSel.get);
  const net = r.total - g.total;
  const { grade, verdict } = gradeTrade(net);
  const cats = CATS.filter((c) => !state.punts.has(c.k));
  const deltas = cats.map((c) => ({ l: c.l, d: r.sums[c.k] - g.sums[c.k] }));
  const maxAbs = Math.max(0.5, ...deltas.map((x) => Math.abs(x.d)));
  const color = net >= 0.4 ? "var(--good)" : net <= -0.4 ? "var(--bad)" : "var(--gold)";
  box.innerHTML =
    `<div class="tr-grade"><div class="g" style="color:${color}">${grade}</div><div class="v">${verdict}</div></div>` +
    `<div class="tr-net">Net value <b style="color:${color}">${net >= 0 ? "+" : ""}${net.toFixed(2)}</b> for the receiving side</div>` +
    deltas.map((x) => {
      const w = (Math.min(Math.abs(x.d) / maxAbs, 1) * 50).toFixed(1);
      const pos = x.d >= 0;
      const style = pos ? `left:50%;width:${w}%;background:var(--good)` : `right:50%;left:auto;width:${w}%;background:var(--bad)`;
      return `<div class="tr-row"><span class="lbl">${x.l}</span><span class="tr-bar"><i style="${style}"></i></span><span class="d ${pos ? "pos-good" : "pos-bad"}">${pos ? "+" : ""}${x.d.toFixed(2)}</span></div>`;
    }).join("");
}

/* ---- matchup simulator (projected H2H week) ---- */
const matchupSel = { mine: [], opp: [] };
function initMatchup() {
  attachAC(document.querySelector('.ac[data-ac="mu-mine"]'), (p) => addMatchup("mine", p.id));
  attachAC(document.querySelector('.ac[data-ac="mu-opp"]'), (p) => addMatchup("opp", p.id));
  document.getElementById("mu-load")?.addEventListener("click", () => {
    matchupSel.mine = [...watchlist].filter((id) => getPlayer(id));
    renderMatchupLists(); renderMatchup();
  });
}
function addMatchup(side, id) {
  if (matchupSel[side].includes(id)) return;
  matchupSel[side].push(id); renderMatchupLists(); renderMatchup();
}
function removeMatchup(side, id) {
  matchupSel[side] = matchupSel[side].filter((x) => x !== id); renderMatchupLists(); renderMatchup();
}
function renderMatchupLists() {
  for (const side of ["mine", "opp"]) {
    const el = document.getElementById(`mu-${side}-list`);
    if (!el) continue;
    el.innerHTML = matchupSel[side].map((id) => {
      const p = getPlayer(id);
      if (!p) return "";
      return `<div class="tl-item">${avatarHTML(p, "tl-photo")}<span class="tl-name">${esc(p.name)}</span><span class="tl-end"><span class="tot">${teamLogo(p.team)}${esc(p.team || "—")}</span> <button data-side="${side}" data-id="${esc(id)}">×</button></span></div>`;
    }).join("");
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => removeMatchup(b.dataset.side, b.dataset.id)));
  }
}
// Project a roster over the schedule week. Counting cats accumulate raw weekly
// totals (per-game × games); % cats accumulate games-weighted makes so we can
// show a games-weighted team FG%/FT%.
function projectRoster(ids, gmap) {
  const raw = {}; let games = 0;
  CAT_KEYS.forEach((k) => (raw[k] = 0));
  ids.forEach((id) => {
    const p = getPlayer(id); if (!p) return;
    const g = gmap[p.team] || 0;
    games += g;
    CAT_KEYS.forEach((k) => {
      const rawKey = k === "fg" ? "fg_pct" : k === "ft" ? "ft_pct" : k;
      raw[k] += (p.stats?.[rawKey] ?? 0) * g;
    });
  });
  return { raw, games };
}
function renderMatchup() {
  const box = document.getElementById("mu-result");
  if (!box) return;
  if (!matchupSel.mine.length || !matchupSel.opp.length) {
    box.innerHTML = '<div class="trade-empty">Add players to both rosters to project the week.</div>';
    return;
  }
  const weekEl = document.getElementById("mu-week");
  if (!scheduleGames.length) {
    box.innerHTML = '<div class="trade-empty">Schedule not loaded yet — projection needs the weekly games.</div>';
    return;
  }
  const anchor = document.getElementById("wk-date")?.value || "2026-01-12";
  const wk = gamesPerWeek(scheduleGames, anchor);
  const gmap = {}; wk.teams.forEach((t) => (gmap[t.team] = t.games));
  if (weekEl) weekEl.textContent = `${wk.weekStart} → ${wk.weekEnd}`;

  const A = projectRoster(matchupSel.mine, gmap);
  const B = projectRoster(matchupSel.opp, gmap);

  // Per-category winner is decided on the *displayed* value so the verdict
  // always matches the numbers shown. Counting cats use the rounded weekly
  // total (TOV: fewer wins); % cats use the games-weighted team percentage.
  const dispVal = (side, k) => {
    if (k === "fg" || k === "ft") return side.games ? +(side.raw[k] / side.games * 100).toFixed(1) : 0;
    return Math.round(side.raw[k]);
  };
  const dispTxt = (side, k) => (k === "fg" || k === "ft")
    ? (side.games ? dispVal(side, k).toFixed(1) + "%" : "—")
    : dispVal(side, k).toLocaleString("en-US");
  let win = 0, loss = 0, tie = 0;
  const rows = CATS.map((c) => {
    const k = c.k, inv = k === "tov";
    const a = dispVal(A, k), b = dispVal(B, k);
    let r = a === b ? 0 : (a > b ? 1 : -1);
    if (inv) r = -r;                 // fewer turnovers wins
    if (r > 0) win++; else if (r < 0) loss++; else tie++;
    const cls = r > 0 ? "mu-win" : r < 0 ? "mu-loss" : "mu-tie";
    return `<div class="mu-row ${cls}">
      <span class="mu-a">${dispTxt(A, k)}</span>
      <span class="mu-cat">${c.l}</span>
      <span class="mu-b">${dispTxt(B, k)}</span>
    </div>`;
  }).join("");

  const verdict = win > loss ? { t: "Projected win", c: "var(--good)" }
    : win < loss ? { t: "Projected loss", c: "var(--bad)" }
    : { t: "Projected tie", c: "var(--gold)" };
  box.innerHTML = `
    <div class="mu-score" style="color:${verdict.c}"><b>${win}</b><span>–</span><b>${loss}</b>${tie ? `<small>(${tie} tie${tie > 1 ? "s" : ""})</small>` : ""}</div>
    <div class="mu-verdict" style="color:${verdict.c}">${verdict.t}</div>
    <div class="mu-games">${A.games} vs ${B.games} games this week</div>
    <div class="mu-head"><span>You</span><span>Cat</span><span>Opp</span></div>
    <div class="mu-rows">${rows}</div>`;
}

/* ---- punt fit finder ---- */
let puntFitId = null;
function rankForPlayer(puntSet, id) {
  const arr = rawPlayers.map((p) => {
    let t = 0; for (const k of CAT_KEYS) if (!puntSet.has(k)) t += p.z?.[k] ?? 0;
    return { id: p.id, t };
  });
  arr.sort((a, b) => b.t - a.t);
  const idx = arr.findIndex((x) => x.id === id);
  return idx < 0 ? null : { rank: idx + 1, total: arr[idx].t };
}
function renderPuntFit() {
  const box = document.getElementById("puntfit-result");
  if (!box) return;
  const p = puntFitId && getPlayer(puntFitId);
  if (!p) { box.innerHTML = ""; return; }
  const base = rankForPlayer(new Set(), puntFitId);
  if (!base) { box.innerHTML = ""; return; }
  const lbl = (k) => CATS.find((c) => c.k === k).l;
  const opts = CAT_KEYS.map((k) => {
    const r = rankForPlayer(new Set([k]), puntFitId);
    return { k, rank: r.rank, delta: base.rank - r.rank };
  }).sort((a, b) => b.delta - a.delta).slice(0, 4);
  box.innerHTML =
    `<div class="pf-base">${esc(p.name)} — overall rank <b>#${base.rank}</b> with no punt. Punts that help most:</div>` +
    `<div class="pf-grid">` + opts.map((o) =>
      `<div class="pf-card"><div class="cat">Punt ${lbl(o.k)}</div>` +
      `<div class="delta">${o.delta > 0 ? "▲ +" + o.delta + " spots" : o.delta === 0 ? "no change" : "▼ " + o.delta}</div>` +
      `<div class="rk">→ rank #${o.rank}</div></div>`).join("") + `</div>`;
}

/* ---- schedule / streaming ---- */
let scheduleGames = [];
let scheduleMin = 0;   // min games filter for the schedule grid
function initSchedule() {
  const date = document.getElementById("wk-date");
  if (!date) return;
  // real default is computed from the data once the schedule loads; this is
  // just a placeholder until then.
  date.value = "2026-01-12";
  document.getElementById("wk-prev").addEventListener("click", () => shiftWeek(-7));
  document.getElementById("wk-next").addEventListener("click", () => shiftWeek(7));
  date.addEventListener("change", renderSchedule);
  const filter = document.getElementById("sched-filter");
  filter?.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn[data-min]");
    if (!b) return;
    scheduleMin = +b.dataset.min;
    filter.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderSchedule();
  });
  loadSchedule();
}
async function loadSchedule() {
  try {
    const r = await fetch(`data/schedule-${state.season}.json`);
    if (!r.ok) throw new Error(r.status);
    scheduleGames = (await r.json()).games;
    // Default the week picker to the real "today" clamped into the season's
    // range, so an in-season visitor lands on the current week (and an
    // off-season visitor lands on the last week played, not a magic date).
    const dateEl = document.getElementById("wk-date");
    if (dateEl) dateEl.value = defaultWeekAnchor(scheduleGames);
    renderSchedule();
  } catch {
    document.getElementById("sched-grid").innerHTML = '<div class="board-loading">Schedule unavailable.</div>';
  }
}
function defaultWeekAnchor(games) {
  if (!games.length) return "2026-01-12";
  const dates = games.map((g) => g.date).sort();
  const first = dates[0], last = dates[dates.length - 1];
  const today = fmtDate(new Date());
  return today < first ? first : today > last ? last : today;
}
function shiftWeek(days) {
  const d = document.getElementById("wk-date");
  const nd = new Date(d.value + "T00:00:00");
  nd.setDate(nd.getDate() + days);
  d.value = fmtDate(nd);
  renderSchedule();
}
function renderSchedule() {
  const grid = document.getElementById("sched-grid");
  if (!grid || !scheduleGames.length) return;
  const anchor = document.getElementById("wk-date").value || "2026-01-12";
  const wk = gamesPerWeek(scheduleGames, anchor);
  if (!wk.teams.length) {
    document.getElementById("wk-range").textContent = `${wk.weekStart} → ${wk.weekEnd}`;
    grid.innerHTML = '<div class="board-loading">No games this week (offseason or break).</div>'; return;
  }
  const maxG = wk.teams[0].games;            // top of the full week (drives stream tag)
  const teams = wk.teams.filter((t) => t.games >= scheduleMin);
  const filterTxt = scheduleMin ? ` · ${teams.length} with ${scheduleMin}+ games` : ` · ${wk.teams.length} teams playing`;
  document.getElementById("wk-range").textContent = `${wk.weekStart} → ${wk.weekEnd}${filterTxt}`;
  if (!teams.length) {
    grid.innerHTML = `<div class="board-loading">No team plays ${scheduleMin}+ games this week.</div>`;
  } else {
  const DOW = ["M", "T", "W", "T", "F", "S", "S"];
  grid.innerHTML = teams.map((t) => {
    const stream = t.games >= Math.max(4, maxG);
    const cells = wk.days.map((d, i) => {
      const g = t.opps[d];
      if (!g) return `<div class="sc-day"><span class="sc-dow">${DOW[i]}</span><span class="sc-opp sc-bye">·</span></div>`;
      const b2b = !!(t.opps[wk.days[i - 1]] || t.opps[wk.days[i + 1]]);
      const oppMark = teamLogo(g.opp) || `<span class="sc-opp-abbr">${esc(g.opp)}</span>`;
      return `<div class="sc-day on${b2b ? " b2b" : ""}" title="${g.away ? "@" : "vs"} ${esc(g.opp)} · ${d.slice(5)}">
        <span class="sc-dow">${DOW[i]}</span>
        <span class="sc-opp">${g.away ? '<i class="sc-at">@</i>' : ""}${oppMark}</span>
      </div>`;
    }).join("");
    return `<div class="sc-team${stream ? " stream" : ""}">
      <div class="sc-head"><span class="tm">${teamLogo(t.team)}${t.team}</span><span class="ct">${t.games}</span></div>
      <div class="sc-week">${cells}</div>
      ${t.b2b ? `<div class="sc-b2b">${t.b2b} back-to-back${t.b2b > 1 ? "s" : ""}</div>` : `<div class="sc-b2b sc-norest">no back-to-backs</div>`}
    </div>`;
  }).join("");
  }
  renderMyTeam();     // refresh the roster's weekly projection for the new week
  renderStreamers();  // streamer ranks are week-specific too
  renderMatchup();    // matchup projection is week-specific too
}
function gamesPerWeek(games, anchor) {
  const [mon, sun] = weekBounds(anchor), ms = fmtDate(mon), ss = fmtDate(sun);
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); days.push(fmtDate(d)); }
  const per = {};  // team -> { dates:[], opps:{date:{opp,away}} }
  for (const g of games) {
    if (g.date < ms || g.date > ss) continue;
    (per[g.home] = per[g.home] || { dates: [], opps: {} });
    per[g.home].dates.push(g.date); per[g.home].opps[g.date] = { opp: g.away, away: false };
    (per[g.away] = per[g.away] || { dates: [], opps: {} });
    per[g.away].dates.push(g.date); per[g.away].opps[g.date] = { opp: g.home, away: true };
  }
  const teams = Object.entries(per).map(([team, info]) => {
    const ds = [...info.dates].sort(); let b2b = 0;
    for (let i = 1; i < ds.length; i++) if (dayDiff(ds[i - 1], ds[i]) === 1) b2b++;
    return { team, games: ds.length, b2b, dates: ds, opps: info.opps };
  });
  teams.sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));
  return { weekStart: ms, weekEnd: ss, days, teams };
}
function weekBounds(anchor) {
  const d = new Date(anchor + "T00:00:00");
  const wd = (d.getDay() + 6) % 7; // Monday = 0
  const mon = new Date(d); mon.setDate(d.getDate() - wd);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return [mon, sun];
}
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ============================ PHASE 3 DEPTH ============================ */

/* ---- radar SVG ---- */
function radarSVG(players, size = 240) {
  const cx = size / 2, cy = size / 2, maxR = size * 0.35;
  const n = CATS.length, step = (2 * Math.PI) / n;
  const angle = (i) => -Math.PI / 2 + i * step;
  const pt = (i, r) => ({ x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) });
  const norm = (z) => Math.max(0.04, Math.min(1, (z + 3) / 6));
  const COLORS = ["#ee6730", "#ffc24b", "#44d07b", "#3a6df0"];
  let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
  // grid polygons
  for (const pct of [0.25, 0.5, 0.75, 1]) {
    const pts = CATS.map((_, i) => { const p = pt(i, maxR * pct); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; });
    svg += `<polygon points="${pts.join(" ")}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
  }
  // axis lines
  for (let i = 0; i < n; i++) {
    const e = pt(i, maxR);
    svg += `<line x1="${cx}" y1="${cy}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
  }
  // player shapes
  players.forEach((player, pi) => {
    const col = COLORS[pi % COLORS.length];
    const points = CATS.map((c, i) => {
      const p = pt(i, maxR * norm(player.z?.[c.k] ?? 0));
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    });
    svg += `<polygon points="${points.join(" ")}" fill="${col}" fill-opacity="0.15" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
    CATS.forEach((c, i) => {
      const p = pt(i, maxR * norm(player.z?.[c.k] ?? 0));
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${col}"/>`;
    });
  });
  // category labels
  CATS.forEach((c, i) => {
    const p = pt(i, maxR + 19);
    const anc = p.x > cx + 4 ? "start" : p.x < cx - 4 ? "end" : "middle";
    svg += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="${anc}" dominant-baseline="middle" fill="rgba(255,255,255,0.62)" font-size="10" font-family="Inter,sans-serif" font-weight="600">${c.l}</text>`;
  });
  return svg + "</svg>";
}

/* ---- tier ---- */
function tierInfo(total) {
  if (total >= 4.5) return { label: "Elite",    cls: "tier-elite" };
  if (total >= 2.5) return { label: "Star",     cls: "tier-star" };
  if (total >= 0.5) return { label: "Starter",  cls: "tier-starter" };
  if (total >= -0.5) return { label: "Deep",    cls: "tier-border" };
  return                     { label: "Below",  cls: "tier-below" };
}
function tierDot(total) {
  if (total >= 4.5) return `<span class="tier-dot tier-dot-elite"  title="Elite"></span>`;
  if (total >= 2.5) return `<span class="tier-dot tier-dot-star"   title="Star"></span>`;
  if (total >= 0.5) return `<span class="tier-dot tier-dot-starter" title="Starter"></span>`;
  return "";
}

/* ---- player stat helpers ---- */
const RAW_MAP = { pts:"pts", reb:"reb", ast:"ast", stl:"stl", blk:"blk", tpm:"tpm", fg:"fg_pct", ft:"ft_pct", tov:"tov" };
const RAW_FMT = (k, v) => v == null ? "—" : (k === "fg" || k === "ft") ? (v * 100).toFixed(1) + "%" : (+v).toFixed(1);

/* ---- player detail modal ---- */
let currentModalPlayer = null;

function initModal() {
  const overlay = document.getElementById("modal-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.getElementById("modal-close")?.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  // focus trap: keep Tab cycling within the open dialog
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !overlay.classList.contains("open")) return;
    const list = [...overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
function openModal(p) {
  currentModalPlayer = p;
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  if (!overlay || !content) return;
  content.innerHTML = buildModalHTML(p);
  // Tab switching
  content.querySelector("#modal-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".modal-tab[data-tab]");
    if (!tab) return;
    content.querySelectorAll(".modal-tab").forEach((t) => t.classList.toggle("active", t === tab));
    const tabBody = document.getElementById("modal-tab-body");
    const which = tab.dataset.tab;
    if (which === "stats") tabBody.innerHTML = buildStatsTabHTML(currentModalPlayer);
    else if (which === "recent") loadAndShowRecent(currentModalPlayer, tabBody);
    else loadAndShowCareer(currentModalPlayer, tabBody);
  });
  // Compare button
  content.querySelector(".modal-cmp-btn")?.addEventListener("click", () => {
    toggleCompare(p.id);
    const btn = content.querySelector(".modal-cmp-btn");
    if (btn) {
      const inCmp = compareList.includes(p.id);
      btn.textContent = inCmp ? "✓ In comparison" : "⊕ Add to compare";
      btn.classList.toggle("in-cmp", inCmp);
    }
  });
  // Best-punt-fit chips (in the Fantasy Stats tab): apply that punt to the board.
  content.addEventListener("click", (e) => {
    const chip = e.target.closest(".mbp-chip[data-k]");
    if (chip) { applyPuntBuild([chip.dataset.k]); closeModal(); }
  });
  // Watchlist (star) button
  content.querySelector(".modal-star-btn")?.addEventListener("click", () => {
    toggleStar(p.id);
    const btn = content.querySelector(".modal-star-btn");
    if (btn) {
      const on = isStarred(p.id);
      btn.textContent = on ? "★ Starred" : "☆ Add to watchlist";
      btn.classList.toggle("in-cmp", on);
    }
  });
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  // a11y: remember what had focus, move focus into the dialog.
  lastFocused = document.activeElement;
  document.getElementById("modal-close")?.focus();
}
let lastFocused = null;
function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  // a11y: return focus to the element that opened the modal.
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  lastFocused = null;
}
function buildModalHTML(p) {
  const tier = tierInfo(p.total);
  const inCmp = compareList.includes(p.id);
  return `
    <div class="modal-header modal-header-photo">
      ${avatarHTML(p, "modal-photo")}
      <div class="modal-head-info">
        <div class="modal-name">${esc(p.name)}</div>
        <div class="modal-meta">${teamLogo(p.team, "tlogo-lg")}${esc(p.team || "—")} · ${esc(p.pos || "—")} · ${p.gp ?? "—"} GP · ${(+(p.min ?? 0)).toFixed(1)} MPG</div>
        <div class="modal-tier-row">
          <span class="modal-total">#${p.rank} &nbsp;·&nbsp; <b>${p.total >= 0 ? "+" : ""}${p.total.toFixed(2)}</b> total z</span>
          <span class="tier-badge ${tier.cls}">${tier.label}</span>
        </div>
      </div>
    </div>
    <div class="modal-tabs" id="modal-tabs">
      <button class="modal-tab active" data-tab="stats">Fantasy Stats</button>
      <button class="modal-tab" data-tab="recent">Recent Form</button>
      <button class="modal-tab" data-tab="career">Career</button>
    </div>
    <div id="modal-tab-body">${buildStatsTabHTML(p)}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost modal-star-btn${isStarred(p.id) ? " in-cmp" : ""}">${isStarred(p.id) ? "★ Starred" : "☆ Add to watchlist"}</button>
      <button class="btn btn-ghost modal-cmp-btn${inCmp ? " in-cmp" : ""}">${inCmp ? "✓ In comparison" : "⊕ Add to compare"}</button>
    </div>`;
}
function buildStatsTabHTML(p) {
  const adv = advancedData[p.id] || {};
  const fmtAdv = (v, pct) => v == null || v === 0 ? "—" : pct ? (v * 100).toFixed(1) + "%" : (+v).toFixed(1);
  const bpmColor = (v) => v == null ? "" : v >= 0 ? "color:var(--good)" : "color:var(--bad)";
  const advSection = `
    <div class="adv-grid">
      <div class="adv-cell"><span class="adv-lbl">PER</span><b class="adv-val">${fmtAdv(adv.per)}</b></div>
      <div class="adv-cell"><span class="adv-lbl">TS%</span><b class="adv-val">${fmtAdv(adv.ts_pct, true)}</b></div>
      <div class="adv-cell"><span class="adv-lbl">USG%</span><b class="adv-val">${fmtAdv(adv.usg_pct, true)}</b></div>
      <div class="adv-cell"><span class="adv-lbl">WS</span><b class="adv-val">${fmtAdv(adv.ws)}</b></div>
      <div class="adv-cell"><span class="adv-lbl">BPM</span><b class="adv-val" style="${bpmColor(adv.bpm)}">${adv.bpm != null ? (adv.bpm >= 0 ? "+" : "") + (+adv.bpm).toFixed(1) : "—"}</b></div>
      <div class="adv-cell"><span class="adv-lbl">VORP</span><b class="adv-val">${fmtAdv(adv.vorp)}</b></div>
    </div>`;
  const bp = bestPuntsForPlayer(p, 3);
  const bpSection = bp.opts.length ? `
    <div class="mbp">
      <div class="mbp-h">Best punt fits <small>where ${esc((p.name || "").split(" ")[0])} climbs the league most — tap to apply</small></div>
      <div class="mbp-row">${bp.opts.map((o) =>
        `<button class="mbp-chip" data-k="${o.k}" type="button">Punt ${CAT_LABEL[o.k]} <b>#${bp.baseRank}→#${o.rank}</b> <i>▲${o.delta}</i></button>`).join("")}</div>
    </div>` : "";
  return `
    <div class="modal-body">
      <div class="modal-radar">${radarSVG([p], 230)}</div>
      <div class="modal-cats">
        ${CATS.map((c) => {
          const z = p.z?.[c.k] ?? 0;
          const punted = state.punts.has(c.k);
          const barPct = Math.max(3, Math.min(100, ((z + 3) / 6) * 100)).toFixed(1);
          const col = z >= 0 ? "var(--good)" : "var(--bad)";
          const raw = p.stats?.[RAW_MAP[c.k]];
          return `<div class="mc-row${punted ? " mc-punted" : ""}">
            <span class="mc-lbl">${c.l}</span>
            <div class="mc-bar-wrap"><div class="mc-bar" style="width:${barPct}%;background:${col}"></div></div>
            <span class="mc-z" style="color:${col}">${z >= 0 ? "+" : ""}${z.toFixed(2)}</span>
            <span class="mc-raw">${RAW_FMT(c.k, raw)}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
    <div class="modal-raw">
      ${CATS.map((c) => {
        const raw = p.stats?.[RAW_MAP[c.k]];
        return `<div class="mraw-cell"><span>${c.l}</span><b>${RAW_FMT(c.k, raw)}</b></div>`;
      }).join("")}
    </div>
    ${advSection}
    ${bpSection}`;
}

/* ---- category leaders ---- */
const LEADERS_META = [
  { key:"pts", label:"PTS",    stat:"pts",    low:false },
  { key:"reb", label:"REB",    stat:"reb",    low:false },
  { key:"ast", label:"AST",    stat:"ast",    low:false },
  { key:"stl", label:"STL",    stat:"stl",    low:false },
  { key:"blk", label:"BLK",    stat:"blk",    low:false },
  { key:"tpm", label:"3PM",    stat:"tpm",    low:false },
  { key:"fg",  label:"FG%",    stat:"fg_pct", low:false },
  { key:"ft",  label:"FT%",    stat:"ft_pct", low:false },
  { key:"tov", label:"TOV ↓",  stat:"tov",    low:true  },
];
function renderLeaders() {
  const grid = document.getElementById("leaders-grid");
  if (!grid || !rawPlayers.length) return;
  grid.innerHTML = LEADERS_META.map((cat) => {
    const sorted = rawPlayers
      .filter((p) => p.stats?.[cat.stat] != null && (p.min ?? 0) >= 20)  // avoid tiny-sample flukes
      .sort((a, b) => cat.low
        ? a.stats[cat.stat] - b.stats[cat.stat]
        : b.stats[cat.stat] - a.stats[cat.stat])
      .slice(0, 5);
    return `<div class="ldr-card">
      <div class="ldr-cat">${cat.label}</div>
      ${sorted.map((p, i) => `
        <div class="ldr-row">
          <span class="ldr-rk">${i + 1}</span>
          <span class="ldr-name" data-id="${esc(p.id)}">${esc(p.name)}</span>
          <span class="ldr-val">${RAW_FMT(cat.key, p.stats[cat.stat])}</span>
        </div>`).join("")}
    </div>`;
  }).join("");
  grid.querySelectorAll(".ldr-name[data-id]").forEach((el) =>
    el.addEventListener("click", () => { const p = getPlayer(el.dataset.id); if (p) openModal(p); }));
}

/* ---- compare ---- */
const compareList = [];
function toggleCompare(id) {
  const i = compareList.indexOf(id);
  if (i >= 0) compareList.splice(i, 1);
  else if (compareList.length < 4) compareList.push(id);
  renderCompareTray();
  render(); // refresh ⊕ button states in table
}
function clearCompare() { compareList.length = 0; renderCompareTray(); render(); }
function renderCompareTray() {
  const tray = document.getElementById("compare-tray");
  if (!tray) return;
  if (!compareList.length) { tray.classList.remove("open"); return; }
  tray.classList.add("open");
  const players = compareList.map(getPlayer).filter(Boolean);
  tray.innerHTML = `<div class="ct-inner">
    <span class="ct-label">Compare ${players.length}/4</span>
    ${players.map((p) =>
      `<span class="ct-player">${esc(p.name)}<button class="ct-remove" data-id="${esc(p.id)}">×</button></span>`
    ).join("")}
    ${players.length >= 2
      ? `<button class="btn btn-primary ct-go" id="ct-open">Compare →</button>` : ""}
    <button class="btn btn-ghost" id="ct-clear">Clear</button>
  </div>`;
  tray.querySelectorAll(".ct-remove").forEach((btn) =>
    btn.addEventListener("click", () => toggleCompare(btn.dataset.id)));
  tray.querySelector("#ct-open")?.addEventListener("click", openCompareModal);
  tray.querySelector("#ct-clear")?.addEventListener("click", clearCompare);
}
function openCompareModal() {
  const players = compareList.map(getPlayer).filter(Boolean);
  if (players.length < 2) return;
  const content = document.getElementById("modal-content");
  const overlay = document.getElementById("modal-overlay");
  if (!content || !overlay) return;
  const COLORS = ["#ee6730", "#ffc24b", "#44d07b", "#3a6df0"];
  const headers = players.map((p, i) =>
    `<th style="color:${COLORS[i % COLORS.length]}"><span class="cmp-th">${avatarHTML(p, "cmp-photo")}<span>${esc(p.name)}</span></span><small style="font-weight:400;color:var(--muted)">${teamLogo(p.team)}${esc(p.team||"")} · ${esc(p.pos||"")}</small></th>`).join("");
  const catRows = CATS.map((c) => {
    const vals = players.map((p) => p.z?.[c.k] ?? 0);
    const best = Math.max(...vals);
    const punted = state.punts.has(c.k);
    return `<tr${punted ? ' style="opacity:.35"' : ""}>
      <td class="cat-lbl">${c.l}</td>
      ${vals.map((v) => `<td class="${v === best && players.length > 1 ? "best" : ""}">${v >= 0 ? "+" : ""}${v.toFixed(2)}</td>`).join("")}
    </tr>`;
  });
  const totals = players.map((p) => puntedTotal(p));
  const bestTotal = Math.max(...totals);
  content.innerHTML = `
    <div class="modal-header">
      <div class="modal-name">Player Comparison</div>
      <div class="modal-meta">${players.length} players · punt settings applied · highest value highlighted green</div>
    </div>
    <div class="cmp-radar">${radarSVG(players, Math.min(300, window.innerWidth - 80))}</div>
    <div class="cmp-legend">${players.map((p, i) =>
      `<span style="color:${COLORS[i % COLORS.length]}">■ ${esc(p.name)}</span>`).join("")}</div>
    <div style="overflow-x:auto;margin-top:14px">
      <table class="cmp-table">
        <thead><tr><th class="cat-lbl">Cat</th>${headers}</tr></thead>
        <tbody>
          ${catRows.join("")}
          <tr class="total-row">
            <td class="cat-lbl">TOTAL</td>
            ${totals.map((v) => `<td class="${v === bestTotal ? "best" : ""}">${v >= 0 ? "+" : ""}${v.toFixed(2)}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>`;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

/* ============================ PHASE 4 PLAYER PROFILES ============================ */

/* ---- career data loading ---- */
const careerCache = {};
let careerSnapshot = null;

async function loadCareerSnapshot() {
  if (careerSnapshot !== null) return;
  try {
    const r = await fetch(`data/career-${state.season}.json`);
    if (r.ok) { const j = await r.json(); careerSnapshot = j.players || {}; }
    else careerSnapshot = {};
  } catch { careerSnapshot = {}; }
}

async function loadCareerData(playerId) {
  if (careerCache[playerId]) return careerCache[playerId];
  if (API) {
    try {
      const r = await fetch(`${API}/api/players/${playerId}/career`,
        { signal: AbortSignal.timeout(12000) });
      if (r.ok) { careerCache[playerId] = await r.json(); return careerCache[playerId]; }
    } catch {}
  }
  if (careerSnapshot === null) await loadCareerSnapshot();
  const data = (careerSnapshot || {})[playerId] || [];
  careerCache[playerId] = data;
  return data;
}

async function loadAndShowCareer(p, tabBody) {
  tabBody.innerHTML = '<div class="career-loading">Loading career stats…</div>';
  const career = await loadCareerData(p.id);
  if (!career.length) {
    tabBody.innerHTML = `<div class="career-empty">Career stats not available yet.<br><small>Run <code>python scripts/gen_career.py</code> locally to generate them.</small></div>`;
    return;
  }
  tabBody.innerHTML =
    `<div class="career-spark">${careerSparkline(career)}</div>` +
    `<div class="career-table-wrap">${buildCareerTable(career)}</div>`;
}

/* ---- career sparkline SVG ---- */
function careerSparkline(seasons) {
  if (seasons.length < 2) return "";
  const W = 560, H = 130;
  const metrics = [
    { key: "pts", label: "PTS", color: "#ee6730" },
    { key: "reb", label: "REB", color: "#3a6df0" },
    { key: "ast", label: "AST", color: "#ffc24b" },
  ];
  const maxVal = Math.max(...metrics.flatMap((m) => seasons.map((s) => s[m.key] ?? 0)), 5);
  const pad = { t: 16, r: 12, b: 28, l: 8 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const x = (i) => pad.l + (seasons.length > 1 ? (i / (seasons.length - 1)) * w : w / 2);
  const y = (v) => pad.t + h - ((v ?? 0) / maxVal) * h;
  let svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:${W}px;display:block">`;
  for (const pct of [0.25, 0.5, 0.75, 1]) {
    const yy = pad.t + h - pct * h;
    svg += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${pad.l + w}" y2="${yy.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  }
  metrics.forEach(({ label, color }, i) => {
    const lx = 12 + i * 55;
    svg += `<line x1="${lx}" y1="8" x2="${lx + 14}" y2="8" stroke="${color}" stroke-width="2"/>`;
    svg += `<text x="${lx + 18}" y="11" fill="rgba(255,255,255,0.55)" font-size="9" font-family="Inter,sans-serif">${label}</text>`;
  });
  metrics.forEach(({ key, color }) => {
    const path = seasons
      .map((s, i) => s[key] != null ? `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}` : null)
      .filter(Boolean).join("");
    if (!path) return;
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    const last = seasons[seasons.length - 1];
    if (last[key] != null)
      svg += `<circle cx="${x(seasons.length - 1).toFixed(1)}" cy="${y(last[key]).toFixed(1)}" r="3" fill="${color}"/>`;
  });
  seasons.forEach((s, i) => {
    if (seasons.length <= 7 || i % 2 === 0 || i === seasons.length - 1) {
      svg += `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="8" font-family="Inter,sans-serif">${(s.season || "").slice(2)}</text>`;
    }
  });
  return svg + "</svg>";
}

/* ---- career table ---- */
function buildCareerTable(seasons) {
  const cols = [
    { h:"Season", k:"season",  fmt:(v)=>v??"—",                              lft:true },
    { h:"Age",    k:"age",     fmt:(v)=>v??"—" },
    { h:"Team",   k:"team",    fmt:(v)=>v??"—",                              lft:true },
    { h:"GP",     k:"gp",      fmt:(v)=>v??"—" },
    { h:"MIN",    k:"min",     fmt:(v)=>v!=null?(+v).toFixed(1):"—" },
    { h:"PTS",    k:"pts",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"REB",    k:"reb",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"AST",    k:"ast",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"STL",    k:"stl",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"BLK",    k:"blk",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"3PM",    k:"tpm",     fmt:(v)=>v!=null?(+v).toFixed(1):"—",         hi:true },
    { h:"FG%",    k:"fg_pct",  fmt:(v)=>v!=null?(v*100).toFixed(1)+"%":"—" },
    { h:"FT%",    k:"ft_pct",  fmt:(v)=>v!=null?(v*100).toFixed(1)+"%":"—" },
    { h:"TOV",    k:"tov",     fmt:(v)=>v!=null?(+v).toFixed(1):"—" },
  ];
  // per-column career min/max → drives both the "career high" mark and a
  // green heat tint so a player's peak/valley seasons pop visually.
  const highs = {}, lows = {};
  for (const c of cols.filter((c) => c.hi)) {
    const vals = seasons.map((s) => s[c.k]).filter((v) => v != null);
    highs[c.k] = vals.length ? Math.max(...vals) : 0;
    lows[c.k]  = vals.length ? Math.min(...vals) : 0;
  }
  const careerHeat = (k, v) => {
    const hi = highs[k], lo = lows[k];
    if (v == null || hi === lo) return "";
    const t = (v - lo) / (hi - lo);           // 0..1 within this player's range
    return `background:rgba(68,208,123,${(0.06 + 0.42 * t).toFixed(3)})`;
  };
  const curSeasons = new Set(["2024-25", "2025-26"]);
  const headers = cols.map((c) => `<th${c.lft?' class="cat-lbl"':""}>${c.h}</th>`).join("");
  const rows = seasons.map((s) => {
    const cur = curSeasons.has(s.season);
    const cells = cols.map((c) => {
      const v = s[c.k];
      const isHigh = c.hi && highs[c.k] && v != null && +v === highs[c.k] && highs[c.k] > 0;
      const bg = c.hi && !isHigh ? careerHeat(c.k, v) : "";
      const cls = c.lft ? "cat-lbl" : isHigh ? "career-high" : "";
      return `<td${cls ? ` class="${cls}"` : ""}${bg ? ` style="${bg}"` : ""}>${c.fmt(v)}</td>`;
    }).join("");
    return `<tr${cur?' class="current-season"':""}>${cells}</tr>`;
  }).join("");
  return `<table class="career-tbl"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---- recent form (game log) ---- */
// Game logs are split per player (data/gamelog/{season}/{id}.json), so opening
// a Recent Form tab downloads only that one ~10 KB file instead of a 4 MB blob.
const recentCache = {};

async function loadGamelog(playerId) {
  if (recentCache[playerId]) return recentCache[playerId];
  if (API) {
    try {
      const r = await fetch(`${API}/api/players/${playerId}/gamelog?season=${state.season}`,
        { signal: AbortSignal.timeout(20000) });
      if (r.ok) { recentCache[playerId] = await r.json(); return recentCache[playerId]; }
    } catch {}
  }
  try {
    const r = await fetch(`data/gamelog/${state.season}/${playerId}.json`);
    if (r.ok) { recentCache[playerId] = await r.json(); return recentCache[playerId]; }
  } catch {}
  recentCache[playerId] = [];
  return recentCache[playerId];
}

async function loadAndShowRecent(p, tabBody) {
  tabBody.innerHTML = '<div class="career-loading">Loading recent games…</div>';
  try {
    const games = await loadGamelog(p.id);
    if (!games.length) {
      tabBody.innerHTML = API
        ? `<div class="career-empty">No game log available for ${esc(p.name)} this season.</div>`
        : `<div class="career-empty">Recent games aren't in the bundled snapshot for ${esc(p.name)}.<br><small>Generate it locally: <code>python scripts/gen_gamelog.py</code></small></div>`;
      return;
    }
    renderRecentTab(p, games, tabBody, 5);
  } catch (err) {
    tabBody.innerHTML = `<div class="career-empty">Couldn't load game log.<br><small>${esc(String(err))}</small></div>`;
  }
}

function renderRecentTab(p, allGames, tabBody, n) {
  const games = allGames.slice(-n);  // last N played
  const seasonAvg = p.stats || {};

  // average over selected games
  const avg = (key) => {
    const vals = games.map((g) => g[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const avgStats = { pts: avg("pts"), reb: avg("reb"), ast: avg("ast"),
                     stl: avg("stl"), blk: avg("blk"), tov: avg("tov"),
                     tpm: avg("tpm"), fg_pct: avg("fg_pct"), ft_pct: avg("ft_pct") };

  const RECENT_COLS = [
    { h: "Date",  k: "date",   fmt: (v) => v?.slice(5) ?? "—", lft: true },
    { h: "Opp",   k: "opp",    fmt: (v) => v ?? "—",           lft: true },
    { h: "Res",   k: "result", fmt: (v) => v?.split(" ")[0] ?? "—", cls: (v) => v?.startsWith("W") ? "win" : "loss" },
    { h: "PTS",   k: "pts",    ref: "pts",    pct: false },
    { h: "REB",   k: "reb",    ref: "reb",    pct: false },
    { h: "AST",   k: "ast",    ref: "ast",    pct: false },
    { h: "STL",   k: "stl",    ref: "stl",    pct: false },
    { h: "BLK",   k: "blk",    ref: "blk",    pct: false },
    { h: "TOV",   k: "tov",    ref: "tov",    pct: false, inv: true },
    { h: "3PM",   k: "tpm",    ref: "tpm",    pct: false },
    { h: "FG%",   k: "fg_pct", ref: "fg_pct", pct: true  },
    { h: "FT%",   k: "ft_pct", ref: "ft_pct", pct: true  },
  ];

  const fmtStat = (v, pct) => v == null ? "—" : pct ? (v * 100).toFixed(1) + "%" : (+v).toFixed(1);

  // heat color based on deviation from season average
  const heatCell = (val, ref, inv) => {
    if (val == null || ref == null || ref === 0) return "";
    const diff = val - ref;
    const pct = diff / Math.abs(ref);
    const good = inv ? pct < -0.1 : pct > 0.1;
    const bad  = inv ? pct > 0.1  : pct < -0.1;
    if (good) return `background:rgba(68,208,123,${Math.min(0.5, Math.abs(pct) * 0.8).toFixed(2)})`;
    if (bad)  return `background:rgba(255,92,108,${Math.min(0.5, Math.abs(pct) * 0.8).toFixed(2)})`;
    return "";
  };

  const headers = RECENT_COLS.map((c) => `<th${c.lft ? ' class="cat-lbl"' : ""}>${c.h}</th>`).join("");

  const avgRow = `<tr class="recent-avg-row">
    ${RECENT_COLS.map((c) => {
      if (!c.ref) return `<td class="cat-lbl" style="font-weight:600">L${n} avg</td>`;
      const v = avgStats[c.ref];
      return `<td style="font-weight:600">${fmtStat(v, c.pct)}</td>`;
    }).join("")}
  </tr>`;

  const gameRows = [...games].reverse().map((g) =>
    `<tr>${RECENT_COLS.map((c) => {
      if (c.fmt) {
        const cls = c.cls ? c.cls(g[c.k]) : (c.lft ? "cat-lbl" : "");
        return `<td${cls ? ` class="${cls}"` : ""}>${c.fmt(g[c.k])}</td>`;
      }
      const v = g[c.k];
      const ref = c.ref ? seasonAvg[c.ref === "fg_pct" ? "fg_pct" : c.ref === "ft_pct" ? "ft_pct" : c.ref] : null;
      const bg = heatCell(v, ref, c.inv);
      return `<td${bg ? ` style="${bg}"` : ""}>${fmtStat(v, c.pct)}</td>`;
    }).join("")}</tr>`
  ).join("");

  const sparkSvg = recentSparkline(games);
  const splits = splitsCard(avgStats, seasonAvg, n);
  const cons = consistencyCard(allGames);   // computed over the full season for a stable read

  tabBody.innerHTML = `
    <div class="recent-n-toggle">
      ${[5, 7, 15, 30].map((x) =>
        `<button class="rnt-btn${x === n ? " active" : ""}" data-n="${x}">Last ${x}</button>`
      ).join("")}
    </div>
    ${cons}
    ${splits}
    ${sparkSvg ? `<div class="career-spark">${sparkSvg}</div>` : ""}
    <div class="career-table-wrap">
      <table class="career-tbl">
        <thead><tr>${headers}</tr></thead>
        <tbody>${avgRow}${gameRows}</tbody>
      </table>
    </div>`;

  tabBody.querySelectorAll(".rnt-btn").forEach((btn) =>
    btn.addEventListener("click", () => renderRecentTab(p, allGames, tabBody, +btn.dataset.n))
  );
}

/* Last-N vs season splits — one chip per category with delta + heat. */
function splitsCard(avgStats, seasonAvg, n) {
  const items = [
    { k: "pts", l: "PTS" }, { k: "reb", l: "REB" }, { k: "ast", l: "AST" },
    { k: "stl", l: "STL" }, { k: "blk", l: "BLK" }, { k: "tpm", l: "3PM" },
    { k: "fg_pct", l: "FG%", pct: true }, { k: "ft_pct", l: "FT%", pct: true },
    { k: "tov", l: "TOV", inv: true },
  ];
  const fmt = (v, pct) => v == null ? "—" : pct ? (v * 100).toFixed(1) + "%" : (+v).toFixed(1);
  const chips = items.map(({ k, l, pct, inv }) => {
    const cur = avgStats[k], ref = seasonAvg[k];
    let cls = "flat", arrow = "→", deltaTxt = "";
    if (cur != null && ref != null && ref !== 0) {
      const diff = cur - ref;
      const rel = diff / Math.abs(ref);
      const better = inv ? rel < -0.05 : rel > 0.05;
      const worse = inv ? rel > 0.05 : rel < -0.05;
      cls = better ? "up" : worse ? "down" : "flat";
      arrow = better ? "▲" : worse ? "▼" : "→";
      deltaTxt = (diff >= 0 ? "+" : "") + (pct ? (diff * 100).toFixed(1) : diff.toFixed(1));
    }
    return `<div class="split-chip split-${cls}">
      <span class="sc-cat">${l}</span>
      <span class="sc-val">${fmt(cur, pct)}</span>
      <span class="sc-delta">${arrow} ${deltaTxt}</span>
    </div>`;
  }).join("");
  return `<div class="splits-head">Last ${n} vs season average</div>
    <div class="splits-grid">${chips}</div>`;
}

/* Consistency / boom-bust — a points-league fantasy score per game, then the
   coefficient of variation (std ÷ mean). Low CV = a steady floor you can rely
   on; high CV = a boom-or-bust night-to-night player. */
const fpScore = (g) => (g.pts ?? 0) + 1.2 * (g.reb ?? 0) + 1.5 * (g.ast ?? 0)
  + 3 * (g.stl ?? 0) + 3 * (g.blk ?? 0) + 2 * (g.tpm ?? 0) - (g.tov ?? 0);

function consistencyCard(allGames) {
  const vals = allGames.map(fpScore).filter((v) => Number.isFinite(v));
  if (vals.length < 4) return "";
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const cv = mean > 0 ? std / mean : 1;
  const max = Math.max(...vals), min = Math.min(...vals);
  const aboveAvg = vals.filter((v) => v >= mean).length;
  const r = cv < 0.28 ? { t: "Rock solid", cls: "good" }
    : cv < 0.40 ? { t: "Consistent", cls: "good" }
    : cv < 0.55 ? { t: "Streaky", cls: "warn" }
    : { t: "Boom / bust", cls: "bad" };
  // CV fills a 0–0.7 meter (clamped); lower fill = steadier.
  const meter = Math.max(4, Math.min(100, (cv / 0.7) * 100)).toFixed(0);
  return `<div class="cons-card">
    <div class="cons-head">Consistency <span class="cons-badge cons-${r.cls}">${r.t}</span></div>
    <div class="cons-stats">
      <div class="cons-stat"><b>${mean.toFixed(1)}</b><span>avg FP</span></div>
      <div class="cons-stat"><b>±${std.toFixed(1)}</b><span>std dev</span></div>
      <div class="cons-stat"><b>${min.toFixed(0)}</b><span>floor</span></div>
      <div class="cons-stat"><b>${max.toFixed(0)}</b><span>ceiling</span></div>
      <div class="cons-stat"><b>${Math.round(aboveAvg / vals.length * 100)}%</b><span>games ≥ avg</span></div>
    </div>
    <div class="cons-meter"><i class="cons-${r.cls}-bar" style="width:${meter}%"></i></div>
    <div class="cons-foot">FP = PTS + 1.2·REB + 1.5·AST + 3·STL + 3·BLK + 2·3PM − TOV · ${vals.length} games · variation ${(cv * 100).toFixed(0)}%</div>
  </div>`;
}

function recentSparkline(games) {
  if (games.length < 3) return "";
  const W = 560, H = 100;
  const metrics = [
    { key: "pts", label: "PTS", color: "#ee6730" },
    { key: "reb", label: "REB", color: "#3a6df0" },
    { key: "ast", label: "AST", color: "#ffc24b" },
  ];
  const maxVal = Math.max(...metrics.flatMap((m) => games.map((g) => g[m.key] ?? 0)), 5);
  const pad = { t: 16, r: 12, b: 24, l: 8 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const x = (i) => pad.l + (games.length > 1 ? (i / (games.length - 1)) * w : w / 2);
  const y = (v) => pad.t + h - ((v ?? 0) / maxVal) * h;
  let svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:${W}px;display:block">`;
  metrics.forEach(({ label, color }, i) => {
    const lx = 12 + i * 55;
    svg += `<line x1="${lx}" y1="8" x2="${lx + 14}" y2="8" stroke="${color}" stroke-width="2"/>`;
    svg += `<text x="${lx + 18}" y="11" fill="rgba(255,255,255,0.55)" font-size="9" font-family="Inter,sans-serif">${label}</text>`;
  });
  metrics.forEach(({ key, color }) => {
    const path = games.map((g, i) => g[key] != null ? `${i ? "L" : "M"}${x(i).toFixed(1)},${y(g[key]).toFixed(1)}` : null).filter(Boolean).join("");
    if (!path) return;
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  });
  games.forEach((g, i) => {
    if (games.length <= 10 || i % 3 === 0 || i === games.length - 1) {
      svg += `<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="8" font-family="Inter,sans-serif">${(g.date || "").slice(5)}</text>`;
    }
  });
  return svg + "</svg>";
}

/* ---- players browse section ---- */
const AVATAR_COLORS = ["#ee6730","#3a6df0","#44d07b","#8b5cf6","#06b6d4","#f59e0b"];
function playerInitials(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0]+parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
}
function avatarColor(name) {
  let h = 0; for (const c of name) h = (h*31 + c.charCodeAt(0)) & 0xfffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
// basketball-reference headshot — player ids are BR slugs (e.g. "jokicni01").
const headshotURL = (id) => `https://www.basketball-reference.com/req/202106291/images/headshots/${id}.jpg`;
// Colored initials avatar with the real headshot layered on top; if the photo
// 404s (older/obscure players) onerror removes it and the initials show through.
function avatarHTML(p, cls) {
  return `<div class="${cls} avatar" style="background:${avatarColor(p.name)}">
    <span class="av-ini">${playerInitials(p.name)}</span>
    <img class="av-img" src="${headshotURL(p.id)}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.remove()" />
  </div>`;
}

const PLAYERS_PAGE_SIZE = 24;
let playersShown = PLAYERS_PAGE_SIZE;

function renderPlayerGrid(query) {
  const grid = document.getElementById("player-grid");
  if (!grid || !rawPlayers.length) return;
  const q = norm(query);
  const filtered = q
    ? rawPlayers.filter((p) => norm(p.name).includes(q) || norm(p.team).includes(q))
    : rawPlayers;
  if (!filtered.length) {
    grid.innerHTML = `<div class="grid-empty"><div class="be-ic">🔍</div>
      <p>No players match “${esc(query)}”.</p>
      <span>Try a last name, or check the spelling.</span></div>`;
    return;
  }
  const shown = filtered.slice(0, playersShown);
  const cards = shown.map((p) => {
    const pts = p.stats?.pts != null ? (+p.stats.pts).toFixed(1) : "—";
    const reb = p.stats?.reb != null ? (+p.stats.reb).toFixed(1) : "—";
    const ast = p.stats?.ast != null ? (+p.stats.ast).toFixed(1) : "—";
    return `<div class="player-card" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="View ${esc(p.name)}">
      <button class="star-btn pc-star${isStarred(p.id) ? " on" : ""}" data-star="${esc(p.id)}" title="${isStarred(p.id) ? "Remove from watchlist" : "Add to watchlist"}">${isStarred(p.id) ? "★" : "☆"}</button>
      <div class="pc-top">
        ${avatarHTML(p, "pc-avatar")}
        <div class="pc-info">
          <div class="pc-name">${esc(p.name)}</div>
          <div class="pc-meta">${teamLogo(p.team)}${esc(p.team||"—")} · ${esc(p.pos||"—")}</div>
        </div>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><b>${pts}</b><span>PTS</span></div>
        <div class="pc-stat"><b>${reb}</b><span>REB</span></div>
        <div class="pc-stat"><b>${ast}</b><span>AST</span></div>
      </div>
      <div class="pc-rank">Fantasy rank <b>#${p.rank}</b> · <b>${p.total>=0?"+":""}${p.total.toFixed(1)}</b> z</div>
    </div>`;
  }).join("");
  const more = filtered.length > shown.length
    ? `<div class="players-more"><button class="btn btn-ghost" id="players-load-more">Show more (${filtered.length-shown.length} remaining)</button></div>`
    : "";
  grid.innerHTML = cards + more;
  grid.querySelectorAll(".player-card[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const star = e.target.closest(".star-btn[data-star]");
      if (star) { e.stopPropagation(); toggleStar(star.dataset.star); return; }
      const p = getPlayer(el.dataset.id); if (p) openModal(p);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const p = getPlayer(el.dataset.id); if (p) openModal(p); }
    });
  });
  grid.querySelector("#players-load-more")?.addEventListener("click", () => {
    playersShown += PLAYERS_PAGE_SIZE;
    renderPlayerGrid(document.getElementById("player-search")?.value.trim() || "");
  });
}

/* ============================ MY TEAM ANALYZER ============================ */
// Treats the watchlist (starred players) as a fantasy roster: totals the
// per-category z-scores, surfaces strengths/weaknesses, and recommends the
// punt build that best fits the team — appliable to the board in one click.

const fullZTotal = (p) => CAT_KEYS.reduce((t, k) => t + (p.z?.[k] ?? 0), 0);

// Apply a set of punt categories to the global board state + sync chip UI.
function applyPuntBuild(keys, scroll = true) {
  state.punts = new Set(keys);
  document.querySelectorAll("#punts .punt-chip").forEach((b) =>
    b.classList.toggle("active", state.punts.has(b.dataset.k)));
  render();
  refreshTools();
  renderMyTeam();
  syncPuntPresets();
  if (scroll) document.getElementById("rankings")?.scrollIntoView({ behavior: "smooth" });
}

/* ---- punt build presets (one-click common builds) ---- */
const PUNT_PRESETS = [
  { label: "No punt", keys: [] },
  { label: "Punt FT%", keys: ["ft"] },
  { label: "Punt FG%", keys: ["fg"] },
  { label: "Punt AST", keys: ["ast"] },
  { label: "Punt 3PM", keys: ["tpm"] },
  { label: "Punt TOV", keys: ["tov"] },
  { label: "Punt FT% + TOV", keys: ["ft", "tov"] },
  { label: "Punt FG% + TOV", keys: ["fg", "tov"] },
  { label: "Punt AST + TOV", keys: ["ast", "tov"] },
];
const setEq = (set, keys) => set.size === keys.length && keys.every((k) => set.has(k));
function renderPuntPresets() {
  const wrap = document.getElementById("puntPresets");
  if (!wrap) return;
  wrap.innerHTML = `<span class="pp-label">Quick builds</span>` + PUNT_PRESETS.map((p, i) =>
    `<button class="pp-btn" data-i="${i}" type="button">${p.label}</button>`).join("");
  wrap.querySelectorAll(".pp-btn").forEach((b) =>
    b.addEventListener("click", () => applyPuntBuild(PUNT_PRESETS[+b.dataset.i].keys, false)));
  syncPuntPresets();
}
function syncPuntPresets() {
  document.querySelectorAll("#puntPresets .pp-btn").forEach((b) =>
    b.classList.toggle("active", setEq(state.punts, PUNT_PRESETS[+b.dataset.i].keys)));
}

/* ---- share + toast ---- */
function shareView() {
  saveState();                       // make sure the URL reflects the board
  const url = new URL(location.href);
  if (watchlist.size) url.searchParams.set("stars", [...watchlist].join(","));
  else url.searchParams.delete("stars");
  const text = url.toString();
  const ok = () => showToast(`Link copied${watchlist.size ? " (with your roster)" : ""}`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => showToast("Copy failed — " + text, true));
  else { prompt("Copy this link:", text); }
}
let toastTimer;
function showToast(msg, isErr = false) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle("toast-err", isErr);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// Projected weekly category production for the roster: per-game raw stats ×
// games each player's team plays in the schedule's selected week. Ties the
// roster to the schedule so you can see what a light/heavy week looks like.
const PROJ_CATS = [
  { k: "pts", l: "PTS" }, { k: "reb", l: "REB" }, { k: "ast", l: "AST" },
  { k: "stl", l: "STL" }, { k: "blk", l: "BLK" }, { k: "tpm", l: "3PM" },
  { k: "tov", l: "TOV", inv: true },
];
function weeklyProjectionPanel(roster) {
  if (!scheduleGames.length) return "";
  const anchor = document.getElementById("wk-date")?.value || "2026-01-12";
  const wk = gamesPerWeek(scheduleGames, anchor);
  const gmap = {};
  wk.teams.forEach((t) => (gmap[t.team] = t.games));
  let totGames = 0;
  const proj = {}; PROJ_CATS.forEach((c) => (proj[c.k] = 0));
  const contributors = roster.filter((p) => gmap[p.team]);
  roster.forEach((p) => {
    const g = gmap[p.team] || 0;
    totGames += g;
    PROJ_CATS.forEach((c) => (proj[c.k] += (p.stats?.[c.k] ?? 0) * g));
  });
  const cells = totGames
    ? PROJ_CATS.map((c) =>
        `<div class="wp-cell${c.inv ? " wp-inv" : ""}"><b>${Math.round(proj[c.k])}</b><span>${c.l}</span></div>`
      ).join("")
    : "";
  const body = totGames
    ? `<div class="wp-meta">${wk.weekStart} → ${wk.weekEnd} · <b>${totGames}</b> total games · ${contributors.length}/${roster.length} players active${roster.length - contributors.length ? ` <span class="wp-bye">(${roster.length - contributors.length} on bye)</span>` : ""}</div>
       <div class="wp-grid">${cells}</div>`
    : `<div class="wp-meta">${wk.weekStart} → ${wk.weekEnd} · no rostered teams play this week.</div>`;
  return `<div class="mt-panel wp-panel">
    <div class="mt-panel-h">Weekly projection <small>from the Schedule week below</small></div>
    ${body}
  </div>`;
}

/* ---- punt optimizer ---------------------------------------------------- */
// Instead of the naive "punt your 3 weakest categories", search candidate punt
// builds and score each by how elite the *roster* is league-wide under it: for
// a punt set, re-rank the whole player pool by kept-category z, then take the
// roster's mean pool percentile. A build helps only if your players climb the
// league in it — which is exactly the value punting actually delivers (your
// specific roster's weaknesses stop counting). Percentiles are normalized
// [0,1], so builds with different punt counts stay directly comparable.
const CAT_LABEL = Object.fromEntries(CATS.map((c) => [c.k, c.l]));

// Every category subset up to `maxSize` (includes the empty set = no punt).
function puntCombos(maxSize = 3) {
  const keys = CAT_KEYS, out = [[]];
  const rec = (start, cur) => {
    if (cur.length === maxSize) return;
    for (let i = start; i < keys.length; i++) {
      const next = [...cur, keys[i]];
      out.push(next);
      rec(i + 1, next);
    }
  };
  rec(0, []);
  return out;
}

// Mean league-pool percentile of the roster under a punt set (1 = pool-best).
function rosterFit(rosterIds, punt) {
  const punted = new Set(punt);
  const tot = (p) => { let t = 0; for (const k of CAT_KEYS) if (!punted.has(k)) t += p.z?.[k] ?? 0; return t; };
  const order = rawPlayers.map((p) => ({ id: p.id, t: tot(p) })).sort((a, b) => b.t - a.t);
  const N = order.length, pct = {};
  order.forEach((x, i) => (pct[x.id] = N > 1 ? (N - 1 - i) / (N - 1) : 1));
  const ps = rosterIds.map((id) => pct[id]).filter((v) => v != null);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
}

// Each extra punted category costs PUNT_PENALTY of "fit" in the ranking. Pure
// percentile would greedily punt every slightly-weak cat (more cats dropped ≈
// higher percentile), ignoring the real cost of giving up a category. The
// penalty means a cat is only worth punting if it adds more than ~1.2 percentile
// points — which keeps balanced rosters at "no punt" and trims junk 3rd punts.
const PUNT_PENALTY = 0.012;
// Single-category punt impact on ONE player's league rank: which punts raise
// this player's value most — the categories worth building a team around them.
// Client-side twin of the backend's punt.best_punts_for_player.
function bestPuntsForPlayer(player, top = 3) {
  const rankUnder = (skip) => {
    const tot = (p) => { let t = 0; for (const k of CAT_KEYS) if (k !== skip) t += p.z?.[k] ?? 0; return t; };
    const order = rawPlayers.map((p) => ({ id: p.id, t: tot(p) })).sort((a, b) => b.t - a.t);
    return order.findIndex((x) => x.id === player.id) + 1;
  };
  const baseRank = rankUnder(null);
  const opts = CAT_KEYS.map((k) => { const rank = rankUnder(k); return { k, rank, delta: baseRank - rank }; });
  opts.sort((a, b) => b.delta - a.delta);
  return { baseRank, opts: opts.filter((o) => o.delta > 0).slice(0, top) };
}

function optimizePunts(roster) {
  const ids = roster.map((p) => p.id);
  const scored = puntCombos(3).map((keys) => {
    const fit = rosterFit(ids, keys);
    return { keys, fit, score: fit - PUNT_PENALTY * keys.length };
  });
  const base = scored.find((s) => s.keys.length === 0)?.fit ?? 0;
  scored.forEach((s) => (s.delta = s.fit - base));   // delta is real percentile gain
  // Rank by penalized score; tie-break toward the simpler (fewer-punt) build.
  scored.sort((a, b) => b.score - a.score || a.keys.length - b.keys.length);
  return { base, builds: scored };
}

function renderMyTeam() {
  const body = document.getElementById("myteam-body");
  if (!body) return;
  const roster = [...watchlist].map(getPlayer).filter(Boolean)
    .sort((a, b) => fullZTotal(b) - fullZTotal(a));

  if (!roster.length) {
    body.innerHTML = `<div class="mt-empty">
      <div class="mt-empty-ic">🏀</div>
      <p>Your roster is empty. Tap the <b>☆</b> on any player to add them here.</p>
      <p class="mt-empty-sub">Build a roster to see your team's category profile and the punt strategy that fits it best.</p>
    </div>`;
    return;
  }

  // Per-category roster totals + per-player average (avg is comparable across
  // roster sizes, so the strength labels don't drift as you add players).
  const sums = {}; CAT_KEYS.forEach((k) => (sums[k] = 0));
  roster.forEach((p) => CAT_KEYS.forEach((k) => (sums[k] += p.z?.[k] ?? 0)));
  const avg = (k) => sums[k] / roster.length;
  const teamTotal = CAT_KEYS.reduce((t, k) => t + sums[k], 0);

  // Diverging bars centered on zero, scaled to the strongest magnitude.
  const maxAbs = Math.max(0.6, ...CATS.map((c) => Math.abs(avg(c.k))));
  const ranked = CATS.map((c) => ({ ...c, a: avg(c.k), s: sums[c.k] }))
    .sort((x, y) => y.a - x.a);
  const tag = (a) => a >= 0.6 ? { t: "Strong", cls: "good" }
    : a >= 0.15 ? { t: "Solid", cls: "ok" }
    : a > -0.3 ? { t: "Thin", cls: "warn" }
    : { t: "Weak", cls: "bad" };

  const bars = ranked.map((c) => {
    const w = (Math.min(Math.abs(c.a) / maxAbs, 1) * 50).toFixed(1);
    const pos = c.a >= 0;
    const style = pos
      ? `left:50%;width:${w}%;background:var(--good)`
      : `right:50%;left:auto;width:${w}%;background:var(--bad)`;
    const tg = tag(c.a);
    return `<div class="mt-row">
      <span class="mt-cat">${c.l}</span>
      <span class="mt-bar"><i style="${style}"></i></span>
      <span class="mt-avg ${pos ? "pos-good" : "pos-bad"}">${pos ? "+" : ""}${c.a.toFixed(2)}</span>
      <span class="mt-tag mt-tag-${tg.cls}">${tg.t}</span>
    </div>`;
  }).join("");

  // Recommended punts: search candidate builds and rank by the roster's mean
  // league-wide percentile under each (see optimizePunts). The top builds are
  // the ones your specific players are most elite in — one click applies any.
  const opt = optimizePunts(roster);
  const fmtFit = (v) => Math.round(v * 100);
  const buildLabel = (keys) => keys.length ? "Punt " + keys.map((k) => CAT_LABEL[k]).join(" + ") : "No punt";
  // Show the no-punt baseline plus the best builds that actually beat it, deduped.
  const top = opt.builds.slice(0, 5).filter((b, i, a) =>
    b.keys.length === 0 || b.delta > 0.0005 || i === 0).slice(0, 3);
  if (!top.some((b) => b.keys.length === 0)) top.push({ keys: [], fit: opt.base, delta: 0 });
  const best = opt.builds[0];
  const balanced = best.keys.length === 0;
  const cards = top.map((b) => {
    const applied = setEq(state.punts, b.keys);
    const isBest = b === best;
    return `<button class="mt-build${applied ? " applied" : ""}${isBest ? " best" : ""}" data-keys="${b.keys.join(",")}" type="button" title="Apply this build to the board">
      <span class="mt-build-tag">${isBest ? "Best fit" : b.keys.length ? "Alt" : "No punt"}</span>
      <span class="mt-build-label">${buildLabel(b.keys)}</span>
      <span class="mt-build-fit"><b>${fmtFit(b.fit)}</b><small>fit</small></span>
      <span class="mt-build-delta ${b.delta > 0.0005 ? "pos-good" : b.delta < -0.0005 ? "pos-bad" : "mt-build-flat"}">${b.keys.length === 0 ? "baseline" : (b.delta >= 0 ? "+" : "") + (b.delta * 100).toFixed(1)}</span>
      ${applied ? `<span class="mt-build-on">● on board</span>` : ""}
    </button>`;
  }).join("");
  const rec = `<div class="mt-rec mt-rec-opt">
    <div class="mt-rec-h">Punt optimizer ${balanced ? "· balanced roster" : "· punt " + best.keys.map((k) => CAT_LABEL[k]).join(" + ")}</div>
    <p>${balanced
      ? "No punt build beats staying balanced — your roster is competitive across the board. Stay flexible and stream for games played."
      : `Builds ranked by your roster's average league percentile (<b>fit</b>). Higher = your players are more elite in that build. Punting <b>${best.keys.map((k) => CAT_LABEL[k]).join(" + ")}</b> lifts your roster <b>+${(best.delta * 100).toFixed(1)}</b> pts vs no punt.`}</p>
    <div class="mt-builds">${cards}</div>
  </div>`;

  const puntNote = state.punts.size
    ? `<div class="mt-punt-note">Board currently punting <b>${[...state.punts].map((k) => k.toUpperCase()).join(", ")}</b>.</div>`
    : "";

  const chips = roster.map((p) => {
    const tot = fullZTotal(p);
    return `<div class="mt-player">
      <span class="mt-pname" data-id="${esc(p.id)}" title="View details">${esc(p.name)}</span>
      <span class="mt-pmeta">${esc(p.pos || "—")} · ${esc(p.team || "—")}</span>
      <span class="mt-ptot ${tot >= 0 ? "pos-good" : "pos-bad"}">${tot >= 0 ? "+" : ""}${tot.toFixed(1)}</span>
      <button class="mt-remove" data-star="${esc(p.id)}" title="Remove from team">×</button>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="mt-summary">
      <div class="mt-stat"><b>${roster.length}</b><span>players</span></div>
      <div class="mt-stat"><b class="${teamTotal >= 0 ? "pos-good" : "pos-bad"}">${teamTotal >= 0 ? "+" : ""}${teamTotal.toFixed(1)}</b><span>total z</span></div>
      <div class="mt-stat"><b>${ranked.filter((c) => c.a >= 0.15).length}/9</b><span>cats above avg</span></div>
    </div>
    <div class="mt-grid">
      <div class="mt-panel">
        <div class="mt-panel-h">Category strength <small>avg z per player</small></div>
        <div class="mt-bars">${bars}</div>
      </div>
      <div class="mt-panel mt-side">
        ${rec}
        ${puntNote}
        <div class="mt-panel-h" style="margin-top:14px">Roster <small>${roster.length}</small></div>
        <div class="mt-roster">${chips}</div>
      </div>
    </div>
    ${weeklyProjectionPanel(roster)}`;

  body.querySelectorAll(".mt-build[data-keys]").forEach((b) =>
    b.addEventListener("click", () => {
      const keys = b.dataset.keys ? b.dataset.keys.split(",") : [];
      applyPuntBuild(keys, false);
    }));
  body.querySelectorAll(".mt-remove[data-star]").forEach((b) =>
    b.addEventListener("click", () => toggleStar(b.dataset.star)));
  body.querySelectorAll(".mt-pname[data-id]").forEach((el) =>
    el.addEventListener("click", () => { const p = getPlayer(el.dataset.id); if (p) openModal(p); }));
}

/* ========================= ROSTER IMPORT (paste / Sleeper) ========================= */
// Fills My Team from a pasted name list or a Sleeper league, mapping each player
// to a BoxScore (basketball-reference) id by normalized name. Fully client-side:
// Sleeper's API is open + CORS-friendly, so this needs no server and no login,
// keeping the static-snapshot architecture intact. Matches feed the watchlist,
// which already drives the whole My Team analyzer.

// --- name matching ---------------------------------------------------------
// Normalize for comparison: strip diacritics (via norm), punctuation, hyphens
// and generational suffixes so "Luka Dončić" ⇄ "Luka Doncic" and
// "Jaren Jackson Jr." ⇄ "Jaren Jackson" both line up.
const cleanName = (s) => norm(s)
  .replace(/[.'’`]/g, "")
  .replace(/-/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
  .replace(/\s+/g, " ")
  .trim();

let _nameIndex = null, _lastIndex = null;
const _push = (map, key, val) => { const a = map.get(key); a ? a.push(val) : map.set(key, [val]); };
function buildNameIndex() {
  _nameIndex = new Map();   // full cleaned name -> [player,...]
  _lastIndex = new Map();   // last-name token  -> [player,...]
  for (const p of rawPlayers) {
    const c = cleanName(p.name);
    if (!c) continue;
    _push(_nameIndex, c, p);
    const toks = c.split(" ");
    _push(_lastIndex, toks[toks.length - 1], p);
  }
}
// When several players share a cleaned name, prefer the fantasy-relevant one
// (highest total z) — that's almost always the active star, not a journeyman.
const _bestOf = (arr) => arr.slice().sort((a, b) => fullZTotal(b) - fullZTotal(a))[0];

function matchName(query) {
  if (!rawPlayers.length) return null;
  if (!_nameIndex) buildNameIndex();
  const c = cleanName(query);
  if (!c) return null;
  if (_nameIndex.has(c)) return _bestOf(_nameIndex.get(c));
  const toks = c.split(" ");
  if (toks.length >= 2) {
    const first = toks[0], last = toks[toks.length - 1];
    const byLast = _lastIndex.get(last);
    if (byLast?.length) {
      const fi = byLast.filter((p) => cleanName(p.name).split(" ")[0][0] === first[0]);
      if (fi.length) return _bestOf(fi);
      if (byLast.length === 1) return byLast[0];   // unique surname, take it
    }
  }
  return null;
}

// Split pasted text into candidate names: one per line or comma, parentheticals
// (team/pos tags like "(DEN - C)") stripped.
function parseNames(text) {
  return text.split(/[\n,\t]/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

// Map a list of raw names to players, de-duping and tracking misses.
function resolveRoster(names) {
  buildNameIndex();
  const seen = new Set(), matched = [], unmatched = [];
  for (const nm of names) {
    const p = matchName(nm);
    if (p) { if (!seen.has(p.id)) { seen.add(p.id); matched.push({ input: nm, player: p }); } }
    else unmatched.push(nm);
  }
  return { matched, unmatched };
}

// --- Sleeper API (open, read-only, CORS-friendly) --------------------------
const SLEEPER = "https://api.sleeper.app/v1";
let _sleeperPlayers = null;   // session cache for the (~MB) NBA player map
async function sleeperPlayers() {
  if (_sleeperPlayers) return _sleeperPlayers;
  const r = await fetch(`${SLEEPER}/players/nba`);
  if (!r.ok) throw new Error("Couldn't load Sleeper's player list.");
  _sleeperPlayers = await r.json();
  return _sleeperPlayers;
}
async function sleeperLeague(id) {
  const [lg, rosters, users] = await Promise.all([
    fetch(`${SLEEPER}/league/${id}`).then((r) => r.ok ? r.json() : null),
    fetch(`${SLEEPER}/league/${id}/rosters`).then((r) => r.ok ? r.json() : []),
    fetch(`${SLEEPER}/league/${id}/users`).then((r) => r.ok ? r.json() : []),
  ]);
  if (!lg) throw new Error("League not found — double-check the league ID.");
  if (lg.sport && lg.sport !== "nba") throw new Error(`That's a ${lg.sport.toUpperCase()} league, not NBA.`);
  return { lg, rosters: rosters || [], users: users || [] };
}
async function sleeperRosterNames(playerIds) {
  const pm = await sleeperPlayers();
  return (playerIds || []).map((pid) => {
    const sp = pm[pid];
    if (!sp) return null;
    return sp.full_name || `${sp.first_name || ""} ${sp.last_name || ""}`.trim();
  }).filter(Boolean);
}

// --- import modal UI -------------------------------------------------------
let _importLastFocus = null;
function initImportModal() {
  const overlay = document.getElementById("import-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeImport(); });
  document.getElementById("import-close")?.addEventListener("click", closeImport);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closeImport();
  });
}
function openImport() {
  _nameIndex = null;   // force a fresh index against the current season's players
  const overlay = document.getElementById("import-overlay");
  const content = document.getElementById("import-content");
  if (!overlay || !content) return;
  if (!rawPlayers.length) { showToast("Players still loading — try again in a moment.", true); return; }
  content.innerHTML = importHTML();
  content.querySelector(".imp-tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".imp-tab[data-t]"); if (t) showImportTab(content, t.dataset.t);
  });
  showImportTab(content, "paste");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  _importLastFocus = document.activeElement;
  content.querySelector(".imp-tab")?.focus();
}
function closeImport() {
  const overlay = document.getElementById("import-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (_importLastFocus?.focus) _importLastFocus.focus();
}

function importHTML() {
  return `
    <div class="imp-h">Import roster</div>
    <div class="imp-tabs">
      <button class="imp-tab active" data-t="paste" type="button">Paste names</button>
      <button class="imp-tab" data-t="sleeper" type="button">Sleeper league</button>
    </div>
    <div id="imp-body"></div>`;
}

function showImportTab(root, which) {
  root.querySelectorAll(".imp-tab").forEach((t) => t.classList.toggle("active", t.dataset.t === which));
  const body = root.querySelector("#imp-body");
  body.innerHTML = which === "sleeper" ? sleeperPanelHTML() : pastePanelHTML();
  if (which === "sleeper") wireSleeperPanel(body);
  else wirePastePanel(body);
}

function pastePanelHTML() {
  return `
    <p class="imp-lead">Paste your roster — one player per line (or comma-separated). Copy it straight from Yahoo, ESPN, Fantrax, anywhere.</p>
    <textarea id="imp-paste" class="imp-ta" rows="8" spellcheck="false"
      placeholder="Nikola Jokic&#10;Shai Gilgeous-Alexander&#10;Anthony Edwards&#10;Jaren Jackson Jr."></textarea>
    <div class="imp-actions">
      <button class="btn btn-primary" id="imp-match" type="button">Match players →</button>
    </div>
    <div id="imp-result"></div>`;
}
function wirePastePanel(body) {
  body.querySelector("#imp-match")?.addEventListener("click", () => {
    const names = parseNames(body.querySelector("#imp-paste")?.value || "");
    if (!names.length) { showToast("Paste a name or two first.", true); return; }
    renderImportResult(body.querySelector("#imp-result"), resolveRoster(names));
  });
}

function sleeperPanelHTML() {
  return `
    <p class="imp-lead">Enter your Sleeper league ID — it's in the league URL: <code>sleeper.com/leagues/<b>ID</b>/…</code>. We'll list the teams so you can pick yours.</p>
    <div class="imp-row">
      <input id="imp-league" class="imp-input" inputmode="numeric" autocomplete="off"
        placeholder="e.g. 1234567890123456789" />
      <button class="btn btn-primary" id="imp-load" type="button">Load league</button>
    </div>
    <div id="imp-teams"></div>
    <div id="imp-result"></div>`;
}
function wireSleeperPanel(body) {
  const input = body.querySelector("#imp-league");
  const loadBtn = body.querySelector("#imp-load");
  const teamsEl = body.querySelector("#imp-teams");
  const resultEl = body.querySelector("#imp-result");
  const run = async () => {
    const id = (input.value || "").trim().replace(/\D/g, "");
    if (!id) { showToast("Enter your Sleeper league ID.", true); return; }
    setBusy(loadBtn, true, "Loading…");
    teamsEl.innerHTML = ""; resultEl.innerHTML = "";
    try {
      const { lg, rosters, users } = await sleeperLeague(id);
      const uById = Object.fromEntries(users.map((u) => [u.user_id, u]));
      const teams = rosters
        .filter((r) => (r.players || []).length)
        .map((r) => {
          const u = uById[r.owner_id];
          const name = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
          return { name, players: r.players || [] };
        });
      if (!teams.length) { teamsEl.innerHTML = `<div class="imp-miss">No rostered teams found in that league.</div>`; return; }
      teamsEl.innerHTML = `
        <div class="imp-lead imp-lg-name">${esc(lg.name || "League")} · pick your team:</div>
        <div class="imp-teamgrid">${teams.map((t, i) =>
          `<button class="imp-team" data-i="${i}" type="button">${esc(t.name)} <span>${t.players.length}</span></button>`).join("")}</div>`;
      teamsEl.querySelectorAll(".imp-team").forEach((b) => b.addEventListener("click", async () => {
        teamsEl.querySelectorAll(".imp-team").forEach((x) => x.classList.toggle("active", x === b));
        resultEl.innerHTML = `<div class="imp-loading">Resolving roster…</div>`;
        try {
          const names = await sleeperRosterNames(teams[+b.dataset.i].players);
          renderImportResult(resultEl, resolveRoster(names));
        } catch (err) { resultEl.innerHTML = `<div class="imp-miss">${esc(err.message)}</div>`; }
      }));
    } catch (err) {
      teamsEl.innerHTML = `<div class="imp-miss">${esc(err.message)}</div>`;
    } finally { setBusy(loadBtn, false, "Load league"); }
  };
  loadBtn?.addEventListener("click", run);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  if (label != null) btn.textContent = label;
}

function renderImportResult(el, { matched, unmatched }) {
  if (!el) return;
  if (!matched.length && !unmatched.length) { el.innerHTML = ""; return; }
  const matchChips = matched.map((m) =>
    `<span class="imp-chip imp-ok" title="${esc(m.input)} → ${esc(m.player.name)}">${esc(m.player.name)}<small>${esc(m.player.team || "")}</small></span>`).join("");
  const missChips = unmatched.map((n) => `<span class="imp-chip imp-bad">${esc(n)}</span>`).join("");
  const has = matched.length;
  el.innerHTML = `
    <div class="imp-result-h">Matched <b>${matched.length}</b>${unmatched.length ? ` · ${unmatched.length} not found` : ""}</div>
    <div class="imp-chips">${matchChips}</div>
    ${unmatched.length ? `<div class="imp-miss-h">Couldn't match — check spelling or add these manually:</div><div class="imp-chips">${missChips}</div>` : ""}
    <div class="imp-actions">
      <label class="imp-replace"><input type="checkbox" id="imp-replace" ${has ? "" : "disabled"}> Replace my current team instead of adding</label>
      <button class="btn btn-primary" id="imp-commit" type="button" ${has ? "" : "disabled"}>
        Add ${matched.length} player${matched.length === 1 ? "" : "s"} to my team
      </button>
    </div>`;
  el.querySelector("#imp-replace")?.addEventListener("change", (e) => {
    const btn = el.querySelector("#imp-commit");
    if (btn) btn.textContent = `${e.target.checked ? "Replace team with" : "Add"} ${matched.length} player${matched.length === 1 ? "" : "s"}${e.target.checked ? "" : " to my team"}`;
  });
  el.querySelector("#imp-commit")?.addEventListener("click", () =>
    commitImport(matched, { replace: el.querySelector("#imp-replace")?.checked }));
}

function commitImport(matched, { replace = false } = {}) {
  if (!matched.length) return;
  if (replace) watchlist.clear();
  matched.forEach((m) => watchlist.add(m.player.id));
  saveWatchlist();
  render();
  renderPlayerGrid(document.getElementById("player-search")?.value.trim() || "");
  renderMyTeam();
  renderStreamers();
  syncStarChip();
  closeImport();
  showToast(`${replace ? "Team set to" : "Added"} ${matched.length} player${matched.length === 1 ? "" : "s"}`);
  document.getElementById("myteam")?.scrollIntoView({ behavior: "smooth" });
}

// HoopIQ frontend — nav, reveals, counters, and the interactive value board.
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
const SEASONS = API
  ? ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"]
  : ["2025-26"]; // only the bundled snapshot is available when hosted

const DEFAULTS = { season: "2025-26", pool: 156, minMin: 12, punts: [],
  pos: "ALL", team: "ALL", search: "", sortKey: "total", sortDir: "desc" };

let state = loadState();
let rawPlayers = [];   // current fetched set (full z, no punt applied)

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initApiLink();
  initReveals();
  initCounters();
  initControls();
  load();
});

/* ---------- nav / reveal / counters ---------- */
function initNav() {
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
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
      el.textContent = Math.floor(p * end).toLocaleString(); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((es, obs) => es.forEach((e) => {
    if (e.isIntersecting) { run(e.target); obs.unobserve(e.target); } }));
  document.querySelectorAll(".hero-stats b[data-count]").forEach((n) => io.observe(n));
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
  if (!SEASONS.includes(s.season)) s.season = DEFAULTS.season;
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
    });
    puntWrap.appendChild(b);
  });

  // search
  const search = document.getElementById("search");
  search.value = state.search;
  search.addEventListener("input", () => { state.search = search.value.trim(); render(); });

  // pool + min minutes (baseline-affecting -> refetch; disabled when hosted)
  bindRange("pool", "poolVal", (v) => { state.pool = v; load(); });
  bindRange("minMin", "minVal", (v) => { state.minMin = v; load(); });
  if (!API) {
    document.getElementById("pool").closest(".tool").classList.add("disabled");
    document.getElementById("minMin").closest(".tool").classList.add("disabled");
  }

  document.getElementById("reset").addEventListener("click", () => {
    state = { ...DEFAULTS, punts: new Set() };
    saveState(); location.reload();
  });
  document.getElementById("export").addEventListener("click", exportCsv);
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
    populateTeams();
    render();
  } catch (err) {
    rawPlayers = [];
    renderEmpty(API
      ? "Couldn't reach the backend. Start it with: uvicorn app.main:app"
      : "Couldn't load the data snapshot.");
  }
}
async function fetchPlayers() {
  if (API) {
    const u = `${API}/api/players?limit=600&season=${state.season}&pool=${state.pool}&min_minutes=${state.minMin}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(r.status);
    return (await r.json()).players;
  }
  const r = await fetch(`data/players-${state.season}.json`);
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).players;
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
  const q = state.search.toLowerCase();
  return board.filter((p) => {
    if (state.team !== "ALL" && p.team !== state.team) return false;
    if (state.pos !== "ALL" && !(p.pos || "").toUpperCase().includes(state.pos)) return false;
    if (q && !p.name.toLowerCase().includes(q) && !(p.team || "").toLowerCase().includes(q)) return false;
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
  const frag = document.createDocumentFragment();
  rows.forEach((p) => frag.appendChild(rowEl(p)));
  tbody.appendChild(frag);

  const puntTxt = state.punts.size ? ` · punting ${[...state.punts].map((k) => k.toUpperCase()).join(", ")}` : "";
  const src = API ? "live engine" : "bundled snapshot";
  setNote(`${rows.length} of ${board.length} players · ${src} · ${state.season} · pool ${state.pool} · ≥${state.minMin} MPG${puntTxt}`);
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
  ];
  const thead = document.querySelector("#rankTable thead");
  const tr = document.createElement("tr");
  cols.forEach((c) => {
    const th = document.createElement("th");
    th.className = (c.cls || "") + (c.z && state.punts.has(c.key) ? " punted" : "");
    const active = state.sortKey === c.key || (c.key === "rank" && state.sortKey === "total");
    th.innerHTML = c.lbl + (active ? `<span class="arr">${state.sortDir === "asc" ? "▲" : "▼"}</span>` : "");
    th.addEventListener("click", () => {
      const key = c.key === "rank" ? "total" : c.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = key === "name" || key === "team" || key === "pos" ? "asc" : "desc"; }
      render();
    });
    tr.appendChild(th);
  });
  thead.innerHTML = "";
  thead.appendChild(tr);
}

function rowEl(p) {
  const tr = document.createElement("tr");
  if (p.rank === 1) tr.className = "top1";
  tr.innerHTML =
    `<td class="l c-rk">${p.rank}</td>` +
    `<td class="l c-name">${esc(p.name)}</td>` +
    `<td class="l c-pos">${esc(p.pos || "")}</td>` +
    `<td class="l c-team">${esc(p.team || "")}</td>` +
    `<td class="c-gp">${p.gp ?? "—"}</td>` +
    `<td class="c-total">${p.total.toFixed(2)}</td>` +
    CATS.map((c) => {
      const z = p.z?.[c.k];
      const punted = state.punts.has(c.k);
      const bg = punted || z == null ? "" : `background:${heat(z)}`;
      return `<td class="z${punted ? " punted" : ""}" style="${bg}">${z == null ? "—" : z.toFixed(2)}</td>`;
    }).join("");
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
  a.download = `hoopiq-${state.season}${state.punts.size ? "-punt-" + [...state.punts].join("-") : ""}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

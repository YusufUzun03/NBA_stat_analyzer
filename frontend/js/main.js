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
  initTools();
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
      refreshTools();
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
    refreshTools();
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

/* ============================ PHASE 2 TOOLS ============================ */
const getPlayer = (id) => rawPlayers.find((p) => p.id === id);

function initTools() {
  attachAC(document.querySelector('.ac[data-ac="give"]'), (p) => addTrade("give", p.id));
  attachAC(document.querySelector('.ac[data-ac="get"]'), (p) => addTrade("get", p.id));
  attachAC(document.querySelector('.ac[data-ac="punt"]'), (p) => { puntFitId = p.id; renderPuntFit(); });
  initSchedule();
}
function refreshTools() { renderTradeLists(); renderTrade(); renderPuntFit(); }

/* ---- reusable autocomplete ---- */
function attachAC(acEl, onPick) {
  if (!acEl) return;
  const input = acEl.querySelector("input");
  const menu = acEl.querySelector(".ac-menu");
  const close = () => { menu.classList.remove("open"); menu.innerHTML = ""; };
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const hits = rawPlayers.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
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
      return `<div class="tl-item"><span>${esc(p.name)}</span><span><span class="tot">${puntedTotal(p).toFixed(1)}</span> <button data-side="${side}" data-id="${esc(id)}">×</button></span></div>`;
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
function initSchedule() {
  const date = document.getElementById("wk-date");
  if (!date) return;
  date.value = "2026-01-12";
  document.getElementById("wk-prev").addEventListener("click", () => shiftWeek(-7));
  document.getElementById("wk-next").addEventListener("click", () => shiftWeek(7));
  date.addEventListener("change", renderSchedule);
  loadSchedule();
}
async function loadSchedule() {
  try {
    const r = await fetch("data/schedule-2025-26.json");
    if (!r.ok) throw new Error(r.status);
    scheduleGames = (await r.json()).games;
    renderSchedule();
  } catch {
    document.getElementById("sched-grid").innerHTML = '<div class="board-loading">Schedule unavailable.</div>';
  }
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
  document.getElementById("wk-range").textContent = `${wk.weekStart} → ${wk.weekEnd} · ${wk.teams.length} teams playing`;
  if (!wk.teams.length) {
    grid.innerHTML = '<div class="board-loading">No games this week (offseason or break).</div>'; return;
  }
  const maxG = wk.teams[0].games;
  grid.innerHTML = wk.teams.map((t) => {
    const stream = t.games >= Math.max(4, maxG);
    return `<div class="sc-team${stream ? " stream" : ""}">` +
      `<div class="sc-head"><span class="tm">${t.team}</span><span class="ct">${t.games}</span></div>` +
      `<div class="sc-dots">${"<span></span>".repeat(t.games)}</div>` +
      (t.b2b ? `<div class="sc-b2b">${t.b2b} back-to-back${t.b2b > 1 ? "s" : ""}</div>` : "") +
      `<div class="sc-dates">${t.dates.map((d) => d.slice(5)).join(" · ")}</div></div>`;
  }).join("");
}
function gamesPerWeek(games, anchor) {
  const [mon, sun] = weekBounds(anchor), ms = fmtDate(mon), ss = fmtDate(sun);
  const per = {};
  for (const g of games) if (g.date >= ms && g.date <= ss) for (const t of [g.home, g.away]) (per[t] = per[t] || []).push(g.date);
  const teams = Object.entries(per).map(([team, ds]) => {
    ds.sort(); let b2b = 0;
    for (let i = 1; i < ds.length; i++) if (dayDiff(ds[i - 1], ds[i]) === 1) b2b++;
    return { team, games: ds.length, b2b, dates: ds };
  });
  teams.sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));
  return { weekStart: ms, weekEnd: ss, teams };
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

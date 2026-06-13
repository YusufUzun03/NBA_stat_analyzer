// HoopIQ frontend behaviour: nav, reveals, count-up, live rankings + punt toggle.
// Live API is only reachable when developing locally; a hosted (GitHub Pages)
// page can't call http://127.0.0.1, so it runs on demo data until a public API
// is deployed. Override the local API with ?api=https://your-api if you host one.
const IS_LOCAL = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const API = new URLSearchParams(location.search).get("api")
  || (IS_LOCAL ? "http://127.0.0.1:8000" : null);
const REPO_URL = "https://github.com/YusufUzun03/NBA_stat_analyzer";

const CATS = [
  ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"],
  ["tpm", "3PM"], ["fg", "FG%"], ["ft", "FT%"], ["tov", "TOV"],
];

// Sample fallback so the board looks alive even if the backend isn't running.
const SAMPLE = [
  { rank: 1, name: "Nikola Jokić", team: "DEN", total: 10.03, stats: { pts: 27.0, reb: 12.8, ast: 10.1 } },
  { rank: 2, name: "Victor Wembanyama", team: "SAS", total: 8.95, stats: { pts: 24.3, reb: 11.0, ast: 3.9 } },
  { rank: 3, name: "Shai Gilgeous-Alexander", team: "OKC", total: 8.12, stats: { pts: 31.1, reb: 5.5, ast: 6.4 } },
  { rank: 4, name: "Kawhi Leonard", team: "LAC", total: 6.86, stats: { pts: 24.8, reb: 6.0, ast: 3.5 } },
  { rank: 5, name: "Tyrese Maxey", team: "PHI", total: 6.76, stats: { pts: 27.4, reb: 4.0, ast: 6.1 } },
  { rank: 6, name: "Luka Dončić", team: "LAL", total: 5.59, stats: { pts: 33.5, reb: 7.7, ast: 8.3 } },
  { rank: 7, name: "Donovan Mitchell", team: "CLE", total: 4.17, stats: { pts: 24.6, reb: 4.5, ast: 4.7 } },
  { rank: 8, name: "Lauri Markkanen", team: "UTA", total: 3.94, stats: { pts: 22.0, reb: 6.0, ast: 1.6 } },
  { rank: 9, name: "Jamal Murray", team: "DEN", total: 3.93, stats: { pts: 21.4, reb: 4.0, ast: 6.2 } },
  { rank: 10, name: "Stephen Curry", team: "GSW", total: 3.74, stats: { pts: 24.5, reb: 4.4, ast: 6.0 } },
];

const punted = new Set();

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initApiLink();
  initReveals();
  initCounters();
  initPunts();
  loadBoard();
});

/* point the nav "API" link at local docs, or the repo when hosted */
function initApiLink() {
  const link = document.getElementById("api-link");
  if (!link) return;
  if (API) {
    link.href = API + "/docs";
    link.textContent = "API";
  } else {
    link.href = REPO_URL;
    link.textContent = "GitHub";
  }
}

/* nav background on scroll */
function initNav() {
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* reveal sections as they enter the viewport */
function initReveals() {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
    { threshold: 0.15 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

/* count-up the hero stat numbers once */
function initCounters() {
  const nums = document.querySelectorAll(".hero-stats b[data-count]");
  const run = (el) => {
    const end = +el.dataset.count;
    const dur = 1200;
    let start;
    const step = (ts) => {
      start ??= ts;
      const p = Math.min((ts - start) / dur, 1);
      el.textContent = Math.floor(p * end).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => { if (e.isIntersecting) { run(e.target); obs.unobserve(e.target); } });
  });
  nums.forEach((n) => io.observe(n));
}

/* punt chips */
function initPunts() {
  const wrap = document.getElementById("punts");
  CATS.forEach(([key, label]) => {
    const chip = document.createElement("button");
    chip.className = "punt-chip";
    chip.textContent = "Punt " + label;
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      punted.has(key) ? punted.delete(key) : punted.add(key);
      loadBoard();
    });
    wrap.appendChild(chip);
  });
}

/* fetch + render rankings */
async function loadBoard() {
  const rows = document.getElementById("board-rows");
  const note = document.getElementById("board-note");
  const puntCsv = [...punted].join(",");

  // Hosted with no public API: show demo data, no dev-only instructions.
  if (!API) {
    render(SAMPLE, rows);
    note.className = "board-note";
    note.textContent = "Demo data · run the backend locally for live, punt-aware rankings.";
    return;
  }

  const url = `${API}/api/players?limit=10${puntCsv ? `&punt=${puntCsv}` : ""}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    render(data.players, rows);
    note.className = "board-note";
    note.textContent = puntCsv
      ? `Re-ranked live · punting ${puntCsv.toUpperCase()} · pool ${data.pool}`
      : `Live from the engine · ${data.players.length} of ${data.season} players · pool ${data.pool}`;
  } catch (err) {
    render(filterSample(), rows);
    note.className = "board-note warn";
    note.textContent = "Showing sample data — start the backend (uvicorn app.main:app) for live rankings.";
  }
}

function filterSample() {
  // sample has no z-data, so punting just annotates; keep order.
  return SAMPLE;
}

function render(players, rows) {
  rows.innerHTML = "";
  players.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "board-row" + (p.rank === 1 ? " top1" : "");
    row.style.animationDelay = `${i * 35}ms`;
    const s = p.stats || {};
    row.innerHTML = `
      <span class="rk">${p.rank}</span>
      <span class="pl">${p.name}</span>
      <span class="tm">${p.team || ""}</span>
      <span class="tot">${fmt(p.total)}</span>
      <span class="hide-sm">${fmt(s.pts)}</span>
      <span class="hide-sm">${fmt(s.reb)}</span>
      <span class="hide-sm">${fmt(s.ast)}</span>`;
    rows.appendChild(row);
  });
}

const fmt = (n) => (n == null ? "—" : (+n).toFixed(1));

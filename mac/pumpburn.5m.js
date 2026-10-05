#!/bin/sh
":" //; for n in "$(command -v node)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.volta/bin/node $(ls "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -rV); do [ -x "$n" ] && exec "$n" "$0" "$@"; done; printf 'PUMP ! | sfimage=flame.circle\n---\nNode.js not found. Install it: brew install node\n'; exit 0
//
//  Line 2 is a shell launcher: SwiftBar starts plugins with a minimal PATH, so it
//  looks for node in the usual places (Homebrew, Volta, newest nvm version) and
//  re-runs this file with it. To node, that line is just a string followed by a comment.
//
//  <xbar.title>PUMP buy & burn</xbar.title>
//  <xbar.version>v2.0</xbar.version>
//  <xbar.desc>Tracks pump.fun's buy-and-burn: burned today/7d/30d/6m, averages, price, 30-day chart.</xbar.desc>
//  <xbar.dependencies>node</xbar.dependencies>
//
//  SwiftBar / xbar plugin. No API key required.
//  Informational only. Not financial advice, not affiliated with pump.fun.
//
//  Install:  drop pumpburn.5m.js in your SwiftBar plugin folder and chmod +x it.
//  Own RPC:  set PUMP_RPC in SwiftBar's environment, or edit the RPC line below.

const RPC      = process.env.PUMP_RPC || "https://api.mainnet-beta.solana.com";
const MINT     = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const BURNER   = "99mRw3EzdJZWEUjgp1nrU4WeHsukUBjbh7gYE7pm4F3c";
const TOTAL    = 1e12;
const KEEP_DAYS = 3;            // local snapshots: only for "last hour" and live rate
const PAGE = "https://pump.fun/pump-token";
const FETCH_EVERY = 60 * 60e3;  // the page is ~2 MB: refetch at most hourly

// Offline fallback: official daily totals copied from pump.fun/pump-token on 2026-09-27.
// Normally the widget reads the live series from that page (see getOfficial).
const SEED = {
  "2026-08-28": { pump: 271.3e6, usd: 1380000 },
  "2026-08-29": { pump: 223.5e6, usd: 1130000 },
  "2026-08-30": { pump: 193.8e6, usd: 997700 },
  "2026-08-31": { pump: 229.0e6, usd: 1030000 },
  "2026-09-01": { pump: 220.7e6, usd: 1050000 },
  "2026-09-02": { pump: 189.0e6, usd: 815300 },
  "2026-09-03": { pump: 163.7e6, usd: 723000 },
  "2026-09-04": { pump: 119.1e6, usd: 524200 },
  "2026-09-05": { pump: 96.3e6, usd: 396000 },
  "2026-09-06": { pump: 114.8e6, usd: 445200 },
  "2026-09-07": { pump: 170.4e6, usd: 749900 },
  "2026-09-08": { pump: 159.0e6, usd: 711200 },
  "2026-09-09": { pump: 185.3e6, usd: 842100 },
  "2026-09-10": { pump: 168.3e6, usd: 676600 },
  "2026-09-11": { pump: 142.4e6, usd: 517200 },
  "2026-09-12": { pump: 158.9e6, usd: 595200 },
  "2026-09-13": { pump: 155.1e6, usd: 580300 },
  "2026-09-14": { pump: 169.8e6, usd: 614500 },
  "2026-09-15": { pump: 206.1e6, usd: 771400 },
  "2026-09-16": { pump: 211.3e6, usd: 773800 },
  "2026-09-17": { pump: 217.0e6, usd: 862800 },
  "2026-09-18": { pump: 189.9e6, usd: 784300 },
  "2026-09-19": { pump: 178.1e6, usd: 783300 },
  "2026-09-20": { pump: 175.8e6, usd: 762900 },
  "2026-09-21": { pump: 199.9e6, usd: 859100 },
  "2026-09-22": { pump: 191.0e6, usd: 874300 },
  "2026-09-23": { pump: 192.5e6, usd: 850900 },
  "2026-09-24": { pump: 211.8e6, usd: 832400 },
  "2026-09-25": { pump: 208.9e6, usd: 838200 },
  "2026-09-26": { pump: 320.4e6, usd: 1460000 },
};

const os   = require("os");
const path = require("path");
const fs   = require("fs");

const DIR   = path.join(os.homedir(), "Library", "Application Support", "PumpBurn");
const STATE = path.join(DIR, "state.json");
const PREFS = path.join(DIR, "prefs.json");     // { chart: "usd" | "pump" }

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS, "utf8")); } catch { return {}; }
}

// Clicking the chart runs this file again with --chart=usd|pump: save the choice and stop.
const chartArg = process.argv.find(a => a.startsWith("--chart="));
if (chartArg) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(PREFS, JSON.stringify({ ...loadPrefs(), chart: chartArg.slice(8) === "pump" ? "pump" : "usd" }));
  } catch { /* non-fatal */ }
  process.exit(0);
}

// ─── pure helpers (shared with PumpBurnWidget.js, covered by test-logic.mjs) ───
function fmt(n) {
  if (n === null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(3) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return Math.round(n / 1e3) + "K";
  return Math.round(n).toString();
}
function usd(n) {
  if (n === null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + n.toFixed(0);
}
// pump.fun counts days in UTC, so we do too.
function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }
function shiftKey(k, delta) { return dayKey(Date.parse(k + "T00:00:00Z") + delta * 864e5); }

// pump.fun/pump-token ships its whole daily series (since launch) inside the
// Next.js payload, with quotes escaped. Returns { "YYYY-MM-DD": {pump, usd, sol} }.
function parseOfficial(html) {
  const text = html.replace(/\\"/g, '"');
  const re = /\{"date":"(\d{4}-\d{2}-\d{2})"[^{}]*?"buybacksSol":([\d.]+),"buybacksUsd":([\d.]+)[^{}]*?"pumpTokensBought":([\d.]+)/g;
  const days = {};
  for (const m of text.matchAll(re)) days[m[1]] = { pump: +m[4], usd: +m[3], sol: +m[2] };
  return days;
}

function sumOf(arr) {
  const k = arr.filter(x => x.pump !== null);
  if (!k.length) return { n: 0, pump: null, usd: null, sol: null };
  return { n: k.length, pump: k.reduce((a, x) => a + x.pump, 0), usd: k.reduce((a, x) => a + (x.usd || 0), 0),
    sol: k.reduce((a, x) => a + (x.sol || 0), 0) };
}

// Today = pump.fun's figure at fetch time + whatever the supply dropped since then.
// Supply only goes down through burns, so the difference is exact even across sleep.
// Right after 00:00 UTC the page has no row for the new day yet: a fetch made in the
// first 10 minutes counts as starting from zero.
function liveToday(off, todayKey, supply, prices) {
  if (!off || dayKey(off.fetchedAt) !== todayKey) return null;
  const sinceMidnight = off.fetchedAt - Date.parse(todayKey + "T00:00:00Z");
  const base = off.days[todayKey] || (sinceMidnight < 10 * 60e3 ? { pump: 0, usd: 0, sol: 0 } : null);
  if (!base) return null;
  const extra = Math.max(0, off.supplyAtFetch - supply);
  const extraUsd = extra * (prices.pump || 0);
  // pump.fun fills in a new day's USD later than its PUMP and SOL: estimate it until then.
  const baseUsd = base.usd || (base.sol && prices.sol ? base.sol * prices.sol : base.pump * (prices.pump || 0));
  return { pump: base.pump + extra, usd: baseUsd + extraUsd, sol: base.sol + (prices.sol ? extraUsd / prices.sol : 0) };
}

// Supply drop against the snapshot closest to one hour ago (40-80 min window), per hour.
function lastHourFrom(snaps, now, supply, prices) {
  const target = now - 3600e3;
  const ref = snaps.filter(x => x[0] >= now - 80 * 60e3 && x[0] <= now - 40 * 60e3)
    .sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
  if (!ref) return null;
  const p = Math.max(0, (ref[1] - supply) * 3600e3 / (now - ref[0]));
  const u = p * (prices.pump || 0);
  return { pump: p, usd: u, sol: prices.sol ? u / prices.sol : null };
}

const pad = (s, n) => String(s).padEnd(n);

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || method);
  return j.result;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { return { snaps: [] }; }
}
function saveState(s) {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  s.snaps = s.snaps.filter(x => x[0] >= cutoff);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch { /* non-fatal */ }
}

async function getOfficial() {
  try {
    const r = await fetch(PAGE, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36" },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const days = parseOfficial(await r.text());
    return Object.keys(days).length > 30 ? days : null;
  } catch { return null; }
}

async function getPrices() {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${MINT},${SOL_MINT}`,
      { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    return { pump: j[MINT]?.usdPrice ?? null, sol: j[SOL_MINT]?.usdPrice ?? null,
      pump24h: j[MINT]?.priceChange24h ?? null, sol24h: j[SOL_MINT]?.priceChange24h ?? null };
  } catch { return { pump: null, sol: null, pump24h: null, sol24h: null }; }
}

async function getBurnRate() {
  try {
    const sigs = await rpc("getSignaturesForAddress", [BURNER, { limit: 300 }]);
    const ts = sigs.map(s => s.blockTime).filter(Boolean).sort((a, b) => a - b);
    if (ts.length < 20) return null;
    const hours = (ts[ts.length - 1] - ts[0]) / 3600;
    return hours > 0 ? ts.length / hours / 2 : null;
  } catch { return null; }
}

(async () => {
  let supply, prices, cyclesHr;
  try {
    const res = await rpc("getTokenSupply", [MINT]);
    supply = Number(res.value.amount) / 10 ** res.value.decimals;
    if (!isFinite(supply) || supply <= 0) throw new Error("bad supply");
    prices = await getPrices();
    cyclesHr = await getBurnRate();
  } catch (e) {
    console.log("PUMP —  | sfimage=flame.circle");
    console.log("---");
    console.log(`Couldn't load data: ${String(e.message).slice(0, 80)} | color=#E36A57`);
    console.log("Refresh | refresh=true");
    process.exit(0);
  }

  const now = Date.now();
  const state = loadState();
  state.snaps.push([now, supply, prices.pump ?? 0]);
  state.snaps.sort((a, b) => a[0] - b[0]);

  const todayKey = dayKey(now);

  // Official series: refetch hourly and on a new UTC day, keep the last good copy.
  let off = state.official;
  // Refetch sooner (5 min) while the page has no row for today yet.
  const stale = !off || dayKey(off.fetchedAt) !== todayKey ||
    now - off.fetchedAt > (off.days[todayKey] ? FETCH_EVERY : 5 * 60e3);
  if (stale) {
    const days = await getOfficial();
    if (days) off = state.official = { fetchedAt: now, supplyAtFetch: supply, days: { ...(off?.days || {}), ...days } };
  }
  const offDays = off?.days || {};

  const dayFor = k => {
    if (offDays[k]) return { ...offDays[k], src: "pump.fun", key: k };
    if (SEED[k]) return { ...SEED[k], sol: prices.sol ? SEED[k].usd / prices.sol : null, src: "offline", key: k };
    return { pump: null, usd: null, sol: null, src: null, key: k };
  };
  const lastN = days => {
    const out = [];
    for (let i = days; i >= 1; i--) out.push(dayFor(shiftKey(todayKey, -i)));
    return out;
  };
  const chartDays = lastN(30);
  const windows = [["Last 7 days", 7], ["Last 30 days", 30], ["Last 3 months", 90], ["Last 6 months", 180]]
    .map(([label, d]) => ({ label, d, ...sumOf(lastN(d)) }));

  // Averages over the whole official history (completed UTC days only).
  const histKeys = Object.keys(offDays).filter(k => k < todayKey).sort();
  const hist = sumOf(histKeys.map(dayFor));
  const avg = hist.n ? { pump: hist.pump / hist.n, usd: hist.usd / hist.n, sol: hist.sol / hist.n } : null;
  const since = histKeys.length ? new Date(histKeys[0] + "T00:00:00Z")
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null;

  const today = liveToday(off, todayKey, supply, prices);
  const lastHour = lastHourFrom(state.snaps, now, supply, prices);

  let pumpHr = null;
  const n = state.snaps.length;
  if (n >= 2) {
    const dt = (now - state.snaps[n - 2][0]) / 3600e3;
    if (dt > 0.01 && dt < 6) pumpHr = Math.max(0, (state.snaps[n - 2][1] - supply) / dt);
  }
  saveState(state);

  const burned = TOTAL - supply;
  const pctTotal = (burned / TOTAL) * 100;
  const F = "font=Menlo size=12";

  const solTxt = v => (v !== null && v !== undefined && isFinite(v)) ? `${Math.round(v).toLocaleString("en-US")} SOL` : null;
  const row = (label, x, note = "") => {
    if (!x || x.pump === null) return console.log(`${pad(label, 15)}— | ${F}`);
    const bits = [pad(`${fmt(x.pump)} PUMP`, 13), pad(usd(x.usd), 8), solTxt(x.sol) ? pad(solTxt(x.sol), 13) : null,
      `${(x.pump / supply * 100).toFixed(3)}% supply`].filter(Boolean);
    console.log(`${pad(label, 15)}${bits.join("  ·  ")}${note} | ${F}`);
  };

  // menu bar
  console.log(`${today ? fmt(today.pump) : "—"} | sfimage=flame font=Menlo size=13`);
  console.log("---");

  const head = t => console.log(`${t} | ${F} color=#9AA0A7`);

  // Price + performance. 1d is Jupiter's 24h change; 1w/1m compare against pump.fun's
  // average buyback price on that UTC day (usd / tokens), so no extra API is needed.
  const pctTxt = v => (v === null || !isFinite(v)) ? "  —  " : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const avgPrice = (k, unit) => { const d = offDays[k]; return d && d[unit] ? d.usd / d[unit] : null; };
  const chg = (cur, ref) => (cur && ref) ? (cur / ref - 1) * 100 : null;
  const rate = [];
  if (cyclesHr) rate.push(`${Math.round(cyclesHr)} burns/hr`);
  if (pumpHr) rate.push(`${fmt(pumpHr)} PUMP/hr`);
  const perf = (label, price, ch24, unit, dp, extra = "") => {
    if (!price) return;
    const w = chg(price, avgPrice(shiftKey(todayKey, -7), unit));
    const m = chg(price, avgPrice(shiftKey(todayKey, -30), unit));
    console.log(`${pad(label, 7)}${pad("$" + price.toFixed(dp), 10)}  1d ${pad(pctTxt(ch24), 7)} 1w ${pad(pctTxt(w), 7)} 1m ${pad(pctTxt(m), 7)}${extra} | ${F}`);
  };
  perf("PUMP", prices.pump, prices.pump24h, "pump", 6, rate.length ? `  ·  ${rate.join("  ·  ")}` : "");
  perf("SOL", prices.sol, prices.sol24h, "sol", 2);
  console.log("---");

  head("Burned");
  row("Last hour", lastHour);
  const w30 = windows[1];
  row("Today (UTC)", today, today && w30.n ? `  ·  ${Math.round(today.pump / (w30.pump / w30.n) * 100)}% of 30d daily avg` : "");
  for (const w of windows) row(w.label, w, w.n && w.n < w.d ? `  (${w.n}/${w.d} d)` : "");
  console.log("---");

  head(`Average${since ? ` (since ${since})` : ""}`);
  const scaled = k => avg ? { pump: avg.pump * k, usd: avg.usd * k, sol: avg.sol * k } : null;
  row("Daily", scaled(1));
  row("Weekly", scaled(7));
  row("Monthly", scaled(30));
  row("3 months", scaled(90));
  row("6 months", scaled(180));
  row("Yearly", scaled(365));
  console.log("---");

  // PUMP from the live supply (exact); USD and SOL are pump.fun's buyback totals.
  const tot = sumOf(Object.keys(offDays).sort().map(dayFor));
  const totBits = [pad(`${fmt(burned)} PUMP`, 13), tot.n ? pad(usd(tot.usd), 8) : null,
    tot.n ? pad(solTxt(tot.sol), 13) : null, `${pctTotal.toFixed(2)}% of 1T`].filter(Boolean);
  console.log(`${pad("Total burned", 15)}${totBits.join("  ·  ")} | ${F}`);
  console.log("---");

  // Column chart of the last 30 days, drawn as SVG (NSImage renders it natively).
  // The default unit shows normally; holding ⌥ swaps in the other one (an "alternate"
  // menu item, so the menu stays open). Clicking a chart makes its unit the default.
  const label = m => m === "usd" ? "USD" : "PUMP";
  const chartSvg = m => {
    const o = m === "usd" ? "pump" : "usd";
    // Compact labels so all 30 fit: no "$" (the title names the unit), 3 significant digits.
    const grey = "#8E8E93";
    const compact = v => v >= 1e7 ? Math.round(v / 1e6) + "M" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3) + "K";
    const big = d => compact(d[m]);
    const small = d => compact(d[o]);
    const W = 760, H = 190, top = 26, bottom = 20, gap = 3, side = 44, right = 8;
    const colW = (W - side - right) / chartDays.length;
    const vals = chartDays.map(d => d[m] || 0);
    // Y scale: round step (1, 2, 2.5 or 5 × 10^n) giving about 4 gridlines.
    const raw = Math.max(...vals, 1) / 4, p10 = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(k => k * p10).find(v => v >= raw);
    const vmax = Math.ceil(Math.max(...vals, 1) / step) * step;
    const plotH = H - top - bottom;
    const axis = [];
    for (let v = 0; v <= vmax + step / 2; v += step) {
      const gy = H - bottom - (v / vmax) * plotH;
      axis.push(`<line x1="${side}" y1="${gy.toFixed(1)}" x2="${W - right}" y2="${gy.toFixed(1)}" stroke="${grey}" stroke-opacity="${v ? 0.15 : 0.4}"/>` +
        `<text x="${side - 6}" y="${(gy + 3).toFixed(1)}" font-family="Menlo" font-size="9" fill="${grey}" text-anchor="end">${v ? (m === "usd" ? "$" : "") + compact(v).replace(/(\.\d*?)0+M$/, "$1M").replace(/\.M$/, "M") : "0"}</text>`);
    }
    const cols = chartDays.map((d, i) => {
      const x = side + i * colW + gap / 2, bw = colW - gap, cx = x + bw / 2;
      const h = d[m] ? (d[m] / vmax) * plotH : 0;
      const y = H - bottom - h;
      const fill = d.src === "pump.fun" ? "#E3A857" : "#7A5C33";
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"/>` +
        (d[m] ? `<text x="${cx.toFixed(1)}" y="${(y - 4).toFixed(1)}" font-family="Menlo" font-size="7.5" fill="${grey}" text-anchor="middle">${big(d)}</text>` : "") +
        (d[o] ? `<text x="${cx.toFixed(1)}" y="${(y - 13).toFixed(1)}" font-family="Menlo" font-size="6.5" fill="${grey}" fill-opacity="0.7" text-anchor="middle">${small(d)}</text>` : "") +
        `<text x="${cx.toFixed(1)}" y="${H - 7}" font-family="Menlo" font-size="9" fill="${grey}" text-anchor="middle">${d.key.slice(8)}</text>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `${axis.join("")}${cols}</svg>`;
    return `image=${Buffer.from(svg).toString("base64")} width=${W} height=${H}`;
  };
  const mode = loadPrefs().chart === "pump" ? "pump" : "usd";
  const other = mode === "usd" ? "pump" : "usd";
  const setDefault = m => `bash="${process.argv[1]}" param1=--chart=${m} terminal=false refresh=true`;
  const title = (m, alt) => `Daily burn, last 30 days in ${label(m)}, UTC  ·  ` +
    (alt ? `click to keep ${label(m)}` : `hold ⌥ for ${label(m === "usd" ? "pump" : "usd")}`);
  console.log(`${title(mode, false)} | ${F} color=#9AA0A7`);
  console.log(`${title(other, true)} | ${F} color=#9AA0A7 alternate=true ${setDefault(other)}`);
  console.log(`| ${chartSvg(mode)}`);
  console.log(`| ${chartSvg(other)} alternate=true ${setDefault(other)}`);
  console.log(`Show chart in ${label(other)}  (or hold ⌥ to peek) | ${setDefault(other)} ${F}`);
  console.log("---");

  console.log(`Open pump.fun burn page | href=https://pump.fun/pump-token ${F}`);
  console.log(`Burner wallet on Solscan | href=https://solscan.io/account/${BURNER} ${F}`);
  console.log(`Refresh | refresh=true ${F}`);
  console.log(`Updated ${new Date().toLocaleTimeString()}  ·  pump.fun data ${off ? new Date(off.fetchedAt).toLocaleTimeString() : "unavailable"} | ${F} color=#5A6067`);
})();

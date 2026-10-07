// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: fire-alt;
//
// PUMP buy & burn — iOS home screen widget (Scriptable, large size)
//
// Tracks pump.fun's buy-and-burn programme:
//   - PUMP burned today (UTC), growing in real time
//   - yesterday, last 7 and last 30 days, in PUMP / USD / % of supply
//   - daily burns for the last 30 days
//   - cumulative total burned and % of the 1T supply
//   - PUMP price and live burn rate
//
// No API key required. Daily history comes from pump.fun's own public page
// (read at most once an hour); supply, prices and burn rate from Solana and Jupiter.
// Informational only. Not financial advice, not affiliated with pump.fun.

// ─── config ──────────────────────────────────────────────────────────────
// Leave RPC as-is to use Solana's public endpoint. For a more reliable feed,
// get a free key at helius.dev and paste the full URL here instead.
const RPC = "https://api.mainnet-beta.solana.com";

const MINT     = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const BURNER   = "99mRw3EzdJZWEUjgp1nrU4WeHsukUBjbh7gYE7pm4F3c";
const TOTAL    = 1e12;             // PUMP nominal total supply
const KEEP_DAYS = 3;               // local snapshots: only for the live rate
const SHOW_RATE = true;            // set false to skip the burn-rate request
const PAGE = "https://pump.fun/pump-token";
const FETCH_EVERY = 60 * 60e3;     // the page is ~2 MB: refetch at most hourly

// Offline fallback: pump.fun's daily totals copied on 2026-09-27, used only if
// the page cannot be read and no earlier copy is cached.
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

const C = {
  bg: "#14161A", card: "#1B1E23", track: "#23262B",
  txt: "#F4F5F6", dim: "#6E747B", dim2: "#9AA0A7", faint: "#5A6067",
  accent: "#E3A857", bar: "#7A5C33", live: "#3DDC97", warn: "#E36A57",
};

// ─── helpers ─────────────────────────────────────────────────────────────
const col = h => new Color(h);
const mono = s => Font.regularMonospacedSystemFont(s);

// ─── pure helpers (same as mac/pumpburn.5m.js, covered by test-logic.mjs) ───
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

// Burn per UTC hour from the local supply snapshots. Each pair of snapshots up to
// 15 min apart is spread over the hours it spans; an hour counts once it has 30+
// minutes of coverage and is scaled to a full hour. Returns, per hour 0-23, the
// average over the previous `days` UTC days, how many days fed it, and today's value.
function hourlyFromSnaps(snaps, now, days = 30) {
  const buckets = {};
  for (let i = 1; i < snaps.length; i++) {
    const [t0, s0, p0] = snaps[i - 1], [t1, s1, p1] = snaps[i];
    const dt = t1 - t0;
    if (dt <= 0 || dt > 15 * 60e3) continue;
    const burned = Math.max(0, s0 - s1), price = (p0 + p1) / 2;
    for (let a = t0; a < t1;) {
      const b = Math.min(t1, (Math.floor(a / 3600e3) + 1) * 3600e3);
      const k = Math.floor(a / 3600e3);
      const x = buckets[k] || (buckets[k] = { pump: 0, usd: 0, ms: 0 });
      const f = (b - a) / dt;
      x.pump += burned * f; x.usd += burned * f * price; x.ms += b - a;
      a = b;
    }
  }
  const todayStart = Date.parse(dayKey(now) + "T00:00:00Z");
  const sum = Array.from({ length: 24 }, () => ({ pump: 0, usd: 0, n: 0 }));
  const today = Array(24).fill(null);
  for (const [k, x] of Object.entries(buckets)) {
    const start = k * 3600e3, h = new Date(start).getUTCHours();
    const scale = 3600e3 / x.ms;
    if (start >= todayStart) {
      if (x.ms >= 10 * 60e3) today[h] = { pump: x.pump * scale, usd: x.usd * scale };
    } else if (start >= todayStart - days * 864e5 && x.ms >= 30 * 60e3) {
      sum[h].pump += x.pump * scale; sum[h].usd += x.usd * scale; sum[h].n++;
    }
  }
  const avg = sum.map(x => x.n ? { pump: x.pump / x.n, usd: x.usd / x.n } : null);
  return { avg, n: sum.map(x => x.n), today };
}

// Today against the 30-day pace: the daily average scaled to the share of the UTC day
// already gone, so at 06:00 UTC today is compared with a quarter of an average day.
// null in the first 30 minutes, when the comparison is noise.
function paceVsAvg(todayPump, dailyAvg, now) {
  const elapsed = (now - Date.parse(dayKey(now) + "T00:00:00Z")) / 864e5;
  if (!dailyAvg || elapsed < 1 / 48) return null;
  return todayPump / (dailyAvg * elapsed) * 100;
}

async function rpc(method, params) {
  const r = new Request(RPC);
  r.method = "POST";
  r.headers = { "Content-Type": "application/json" };
  r.body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  r.timeoutInterval = 20;
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || method);
  return j.result;
}

// ─── persistent state ────────────────────────────────────────────────────
// snaps: [timestampMs, supply, pumpPriceUsd] — one per widget refresh.
const fm = FileManager.local();
const STATE = fm.joinPath(fm.documentsDirectory(), "pump-burn-state.json");

function loadState() {
  try {
    if (fm.fileExists(STATE)) {
      const s = JSON.parse(fm.readString(STATE));
      if (Array.isArray(s.snaps)) return s;
    }
  } catch (e) { /* corrupt file: start over */ }
  return { snaps: [] };
}
function saveState(s) {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  s.snaps = s.snaps.filter(x => x[0] >= cutoff);
  try { fm.writeString(STATE, JSON.stringify(s)); } catch (e) { /* read-only: skip */ }
}

// ─── fetch ───────────────────────────────────────────────────────────────
async function getPrices() {
  try {
    const r = new Request(`https://lite-api.jup.ag/price/v3?ids=${MINT},${SOL_MINT}`);
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    return { pump: j[MINT]?.usdPrice ?? null, sol: j[SOL_MINT]?.usdPrice ?? null,
      pump24h: j[MINT]?.priceChange24h ?? null };
  } catch (e) {
    return { pump: null, sol: null, pump24h: null };
  }
}

async function getOfficial() {
  try {
    const r = new Request(PAGE);
    r.headers = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" };
    r.timeoutInterval = 25;
    const days = parseOfficial(await r.loadString());
    return Object.keys(days).length > 30 ? days : null;
  } catch (e) {
    return null;
  }
}

/** Burn transactions per hour, measured over whatever window 300 signatures span. */
async function getBurnRate() {
  try {
    const sigs = await rpc("getSignaturesForAddress", [BURNER, { limit: 300 }]);
    const ts = sigs.map(s => s.blockTime).filter(Boolean).sort((a, b) => a - b);
    if (ts.length < 20) return null;
    const hours = (ts[ts.length - 1] - ts[0]) / 3600;
    if (hours <= 0) return null;
    return ts.length / hours / 2;              // two transactions per buy+burn cycle
  } catch (e) {
    return null;
  }
}

// ─── widget drawing ──────────────────────────────────────────────────────
const scr = Device.screenSize();
const W = (scr.width <= 375 && scr.height <= 700) ? 258 : Math.round(scr.width * 0.76);

function label(p, t, size = 11, c = C.dim) {
  const x = p.addText(t);
  x.font = Font.systemFont(size);
  x.textColor = col(c);
  return x;
}
function num(p, t, size, c = C.txt) {
  const x = p.addText(t);
  x.font = size >= 18 ? Font.mediumRoundedSystemFont(size) : mono(size);
  x.textColor = col(c);
  return x;
}
function progress(p, w, h, frac, fg) {
  const outer = p.addStack();
  outer.size = new Size(w, h);
  outer.backgroundColor = col(C.track);
  outer.cornerRadius = h / 2;
  outer.setPadding(0, 0, 0, 0);
  const inner = outer.addStack();
  inner.size = new Size(Math.max(2, Math.min(w, w * frac)), h);
  inner.backgroundColor = col(fg);
  inner.cornerRadius = h / 2;
  outer.addSpacer();
}

function buildWidget(d) {
  const w = new ListWidget();
  w.backgroundColor = col(C.bg);
  w.setPadding(14, 15, 14, 15);

  // header
  const head = w.addStack();
  head.centerAlignContent();
  const ic = head.addText("◆");
  ic.font = Font.systemFont(11);
  ic.textColor = col(C.accent);
  head.addSpacer(6);
  const title = head.addText("Pump buy & burn");
  title.font = Font.mediumSystemFont(13);
  title.textColor = col("#C9CDD2");
  head.addSpacer();
  const dot = head.addStack();
  dot.size = new Size(6, 6);
  dot.cornerRadius = 3;
  dot.backgroundColor = col(d.stale ? C.warn : C.live);
  head.addSpacer(5);
  label(head, d.stale ? "stale" : "live", 11);

  w.addSpacer(11);

  // today
  label(w, "Today (UTC)", 11);
  w.addSpacer(2);
  const todayRow = w.addStack();
  todayRow.bottomAlignContent();
  num(todayRow, d.today === null ? "—" : fmt(d.today.pump), 30, C.accent);
  todayRow.addSpacer(6);
  const u = todayRow.addText("PUMP");
  u.font = Font.systemFont(13);
  u.textColor = col("#8A9098");
  todayRow.addSpacer();
  num(todayRow, d.today ? usd(d.today.usd) : "—", 15, C.accent);
  w.addSpacer(4);

  const sub = [];
  if (d.today) sub.push(Math.round(d.today.sol).toLocaleString("en-US") + " SOL spent");
  const pace = d.today && d.avg30 ? paceVsAvg(d.today.pump, d.avg30, Date.now()) : null;
  if (pace !== null) sub.push(Math.round(pace) + "% of 30d pace");
  num(w, sub.length ? sub.join("  ·  ") : "waiting for pump.fun data…", 11, C.dim);

  w.addSpacer(11);

  // three metric cards
  const cards = w.addStack();
  const cardW = (W - 2 * 7) / 3;
  const mkCard = (title, x) => {
    const pump = x.pump, usdVal = x.usd, pctVal = x.pump !== null ? (x.pump / d.supply) * 100 : null;
    const c = cards.addStack();
    c.layoutVertically();
    c.size = new Size(cardW, 0);
    c.backgroundColor = col(C.card);
    c.cornerRadius = 9;
    c.setPadding(8, 8, 8, 8);
    const fit = t => { t.lineLimit = 1; t.minimumScaleFactor = 0.6; };
    fit(label(c, title, 11));
    c.addSpacer(2);
    fit(num(c, pump === null ? "—" : fmt(pump), 18));
    c.addSpacer(2);
    fit(num(c, usd(usdVal), 11, C.dim2));
    c.addSpacer(1);
    fit(num(c, pctVal === null ? "—" : pctVal.toFixed(3) + "%", 11, C.accent));
  };
  mkCard("Yesterday", d.y1);
  cards.addSpacer(7);
  mkCard("Last 7 days", d.w7);
  cards.addSpacer(7);
  mkCard("Last 30 days", d.w30);

  w.addSpacer(11);

  // last 30 days, zero-based so the heights compare honestly
  const vmax = Math.max(...d.chart.map(x => x.pump || 0), 1);
  const bars = w.addStack();
  bars.bottomAlignContent();
  const gapB = 2;
  const bw = (W - (d.chart.length - 1) * gapB) / d.chart.length;
  d.chart.forEach((x, i) => {
    if (i) bars.addSpacer(gapB);
    const h = Math.max(2, Math.round(40 * (x.pump || 0) / vmax));
    const b = bars.addStack();
    b.size = new Size(bw, h);
    b.cornerRadius = 2;
    b.backgroundColor = col(x.official ? C.accent : C.bar);
  });
  w.addSpacer(3);
  const ticks = w.addStack();
  d.chart.forEach((x, i) => {
    if (i) ticks.addSpacer(gapB);
    const t = ticks.addStack();
    t.size = new Size(bw, 12);
    t.centerAlignContent();
    // a date every 5 days, counted back from yesterday so the last column is always labelled
    const show = (d.chart.length - 1 - i) % 5 === 0;
    const lab = t.addText(show ? String(Number(x.key.slice(-2))) : "");
    lab.lineLimit = 1;
    lab.minimumScaleFactor = 0.5;
    lab.font = mono(9);
    lab.textColor = col(C.faint);
  });

  w.addSpacer(11);

  // total burned
  const totRow = w.addStack();
  totRow.bottomAlignContent();
  label(totRow, "Total burned", 11);
  totRow.addSpacer();
  num(totRow, d.pctTotal.toFixed(2) + "% of 1T", 11, C.accent);
  w.addSpacer(2);
  const tRow = w.addStack();
  tRow.bottomAlignContent();
  num(tRow, fmt(d.burnedTotal), 20);
  tRow.addSpacer(6);
  num(tRow, "of 1,000B", 11, C.dim);
  w.addSpacer(6);
  progress(w, W, 4, d.pctTotal / 100, C.accent);

  w.addSpacer();

  // footer
  const foot = [];
  if (d.prices.pump) foot.push("$" + d.prices.pump.toFixed(5) +
    (d.prices.pump24h !== null ? ` ${d.prices.pump24h >= 0 ? "+" : ""}${d.prices.pump24h.toFixed(1)}%` : ""));
  if (d.cyclesHr) foot.push(Math.round(d.cyclesHr) + " burns/hr");
  if (d.pumpHr) foot.push(fmt(d.pumpHr) + " PUMP/hr");
  foot.push(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  num(w, foot.join("  ·  "), 11, C.faint);

  w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = col(C.bg);
  w.setPadding(14, 15, 14, 15);
  const t = w.addText("Pump buy & burn");
  t.font = Font.mediumSystemFont(13);
  t.textColor = col("#C9CDD2");
  w.addSpacer(8);
  const e = w.addText("Couldn't load data");
  e.font = Font.systemFont(15);
  e.textColor = col(C.warn);
  w.addSpacer(4);
  const m = w.addText(String(msg).slice(0, 120));
  m.font = Font.systemFont(11);
  m.textColor = col(C.dim);
  w.refreshAfterDate = new Date(Date.now() + 5 * 60e3);
  return w;
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const supplyRes = await rpc("getTokenSupply", [MINT]);
  const supply = Number(supplyRes.value.amount) / 10 ** supplyRes.value.decimals;
  if (!isFinite(supply) || supply <= 0) throw new Error("bad supply");

  const prices = await getPrices();
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
    if (offDays[k]) return { ...offDays[k], official: true, key: k };
    if (SEED[k]) return { ...SEED[k], sol: prices.sol ? SEED[k].usd / prices.sol : null, official: false, key: k };
    return { pump: null, usd: null, sol: null, official: false, key: k };
  };
  const lastN = n => {
    const out = [];
    for (let i = n; i >= 1; i--) out.push(dayFor(shiftKey(todayKey, -i)));
    return out;
  };
  const y1 = sumOf(lastN(1)), w7 = sumOf(lastN(7)), w30 = sumOf(lastN(30));
  const today = liveToday(off, todayKey, supply, prices);

  // Rate over the whole of the last two hours rather than the last pair of
  // refreshes, so it survives iOS waking the widget twice in quick succession.
  let pumpHr = null;
  const win = state.snaps.filter(x => x[0] >= now - 2 * 3600e3 && x[0] < now);
  if (win.length) {
    const dt = (now - win[0][0]) / 3600e3;
    if (dt > 0.004) pumpHr = Math.max(0, (win[0][1] - supply) / dt);
  }

  const cyclesHr = SHOW_RATE ? await getBurnRate() : null;
  saveState(state);

  const burnedTotal = TOTAL - supply;
  return buildWidget({
    burnedTotal,
    pctTotal: (burnedTotal / TOTAL) * 100,
    today, avg30: w30.n ? w30.pump / w30.n : null,
    y1, w7, w30, supply,
    chart: lastN(30), pumpHr, cyclesHr, prices,
    stale: prices.pump === null || !off || now - off.fetchedAt > 6 * 3600e3,
  });
}

let widget;
try {
  widget = await main();
} catch (e) {
  widget = errorWidget(e.message || e);
}

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();

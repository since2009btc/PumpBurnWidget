// Tests for the pure logic shared by the iPhone widget and the Mac plugin.
// Run: node test-logic.mjs
import { readFileSync } from 'node:fs';

// Pull the helper block out of each script: from fmt() up to the given end marker.
async function load(file, endMarker) {
  const src = readFileSync(file, 'utf8');
  const block = src.slice(src.indexOf('function fmt(n)'), src.indexOf(endMarker));
  const names = ['fmt', 'usd', 'dayKey', 'shiftKey', 'parseOfficial', 'sumOf', 'liveToday', 'lastHourFrom'];
  return import('data:text/javascript,' + encodeURIComponent(`${block}\nexport { ${names.join(', ')} };`));
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '  ok' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + extra}`);
};

// A slice of the page payload as it arrives: JSON inside a JS string, quotes escaped.
const FIXTURE = String.raw`self.__next_f.push([1,"{\"date\":\"2026-09-25\",\"stableRevenue\":1,\"revenueUsd\":2,\"buybacksSol\":7123.5,\"buybacksUsd\":838175.4,\"buybackPercentage\":49.31,\"pumpTokensBought\":208899235.4,\"transactionCount\":12685,\"cumulativeUsd\":3},{\"date\":\"2026-09-26\",\"stableRevenue\":1,\"revenueUsd\":2,\"buybacksSol\":11886.5,\"buybacksUsd\":1463680.2,\"buybackPercentage\":52.04,\"pumpTokensBought\":320350264.9,\"transactionCount\":13060,\"cumulativeUsd\":4},{\"date\":\"2026-09-26\",\"solanaWallets\":865946,\"exclPumpWallets\":104096}"])`;

for (const [label, file, end] of [
  ['iPhone', 'PumpBurnWidget.js', 'async function rpc('],
  ['Mac', 'mac/pumpburn.5m.js', 'const pad = '],
]) {
  const { fmt, usd, dayKey, shiftKey, parseOfficial, sumOf, liveToday, lastHourFrom } = await load(file, end);
  console.log(`\n=== ${label} (${file}) ===`);

  console.log('--- formatting ---');
  ok('1.378B', fmt(1.3781e9) === '1.378B', fmt(1.3781e9));
  ok('196.9M', fmt(196.9e6) === '196.9M', fmt(196.9e6));
  ok('$5.60M', usd(5597600) === '$5.60M', usd(5597600));
  ok('$800K', usd(799657) === '$800K', usd(799657));
  ok('null -> dash', fmt(null) === '—' && usd(NaN) === '—');

  console.log('--- UTC day keys ---');
  ok('00:00 UTC -> that day', dayKey(Date.UTC(2026, 8, 22, 0, 0)) === '2026-09-22');
  ok('23:59 UTC -> same day', dayKey(Date.UTC(2026, 8, 22, 23, 59)) === '2026-09-22');
  ok('shift -1', shiftKey('2026-09-22', -1) === '2026-09-21');
  ok('across month', shiftKey('2026-10-01', -1) === '2026-09-30');
  ok('across year', shiftKey('2027-01-01', -1) === '2026-12-31');
  ok('leap day', shiftKey('2028-03-01', -1) === '2028-02-29');
  ok('across DST', shiftKey('2026-10-26', -1) === '2026-10-25');

  console.log('--- parsing pump.fun page ---');
  const days = parseOfficial(FIXTURE);
  ok('two buyback days found', Object.keys(days).length === 2, JSON.stringify(Object.keys(days)));
  ok('wallet series ignored', days['2026-09-26'].pump === 320350264.9, JSON.stringify(days['2026-09-26']));
  ok('pump / usd / sol mapped', days['2026-09-25'].pump === 208899235.4 && days['2026-09-25'].usd === 838175.4 && days['2026-09-25'].sol === 7123.5);
  ok('garbage -> empty', Object.keys(parseOfficial('<html>nothing here</html>')).length === 0);

  console.log('--- sums ---');
  const s = sumOf([{ pump: 100, usd: 1, sol: 2 }, { pump: null }, { pump: 50, usd: 3, sol: 4 }]);
  ok('skips missing days', s.n === 2 && s.pump === 150 && s.usd === 4 && s.sol === 6, JSON.stringify(s));
  ok('all missing -> null', sumOf([{ pump: null }]).pump === null);

  console.log('--- today = official + supply drop since fetch ---');
  const fetchedAt = Date.UTC(2026, 8, 27, 8, 0);
  const off = { fetchedAt, supplyAtFetch: 1000e6, days: { '2026-09-27': { pump: 90e6, usd: 400e3, sol: 3200 } } };
  const t = liveToday(off, '2026-09-27', 990e6, { pump: 0.005, sol: 125 });
  ok('adds burns since fetch', t.pump === 100e6, fmt(t.pump));
  ok('prices the extra', Math.abs(t.usd - 450e3) < 1e-6 && Math.abs(t.sol - 3600) < 1e-6, `${t.usd} ${t.sol}`);
  ok('stale fetch (yesterday) -> null', liveToday({ ...off, fetchedAt: fetchedAt - 864e5 }, '2026-09-27', 990e6, {}) === null);
  const midnight = Date.UTC(2026, 9, 2, 0, 0);
  const early = { fetchedAt: midnight + 10e3, supplyAtFetch: 1000e6, days: {} };
  ok('fetched just after midnight, no row yet -> counts from zero', liveToday(early, '2026-10-02', 995e6, { pump: 0.01, sol: 100 }).pump === 5e6);
  ok('no row and fetched late in the day -> null', liveToday({ ...early, fetchedAt: midnight + 3600e3 }, '2026-10-02', 995e6, {}) === null);
  ok('supply up (glitch) adds nothing', liveToday(off, '2026-09-27', 1001e6, { pump: 1, sol: 1 }).pump === 90e6);

  console.log('--- last hour ---');
  const now = Date.UTC(2026, 8, 27, 9, 0);
  const snaps = [[now - 90 * 60e3, 1000, 1], [now - 58 * 60e3, 900, 1], [now - 30 * 60e3, 850, 1]];
  const h = lastHourFrom(snaps, now, 800, { pump: 0.01, sol: 100 });
  ok('uses the snapshot nearest to -60 min, per hour', Math.abs(h.pump - 100 * 60 / 58) < 1e-9, h && h.pump);
  ok('no snapshot in 40-80 min -> null', lastHourFrom([[now - 10 * 60e3, 1, 1]], now, 1, {}) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

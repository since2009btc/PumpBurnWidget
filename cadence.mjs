// cadence.mjs — how often pump.fun's burner fires: events per hour, gaps between
// events, and how they spread over the UTC day. Reads up to 12,000 recent signatures.
// Usage: node cadence.mjs            (RPC=... to use your own endpoint)

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const BURNER = '99mRw3EzdJZWEUjgp1nrU4WeHsukUBjbh7gYE7pm4F3c';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rpc(method, params) {
  for (let a = 0; a < 8; a++) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * 2 ** a); continue; }
    const j = await r.json();
    if (j.error) { await sleep(800 * 2 ** a); continue; }
    return j.result;
  }
  throw new Error(`RPC ${method} failed after 8 attempts`);
}

let before;
const all = [];
for (let p = 0; p < 12; p++) {
  const page = await rpc('getSignaturesForAddress', [BURNER, { limit: 1000, ...(before && { before }) }]);
  if (!page?.length) break;
  all.push(...page.filter(s => !s.err));
  before = page[page.length - 1].signature;
  process.stderr.write(`\rpage ${p + 1}: ${all.length} signatures`);
  await sleep(400);
}

const t = all.map(s => s.blockTime).sort((a, b) => a - b);
const span = (t.at(-1) - t[0]) / 3600;
console.error(`\n\nCoverage: ${span.toFixed(1)}h  (${new Date(t[0] * 1e3).toISOString()} -> ${new Date(t.at(-1) * 1e3).toISOString()})`);
console.log(`Total events: ${t.length}  =>  ${(t.length / span).toFixed(0)}/hour`);

const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
const q = p => gaps[Math.floor(gaps.length * p)];
console.log(`Gap between events: median ${q(.5)}s | p90 ${q(.9)}s | p99 ${q(.99)}s | max ${gaps.at(-1)}s`);
console.log(`Pauses > 5 minutes: ${gaps.filter(g => g > 300).length}`);

const byHour = {};
for (const x of t) { const k = new Date(x * 1e3).getUTCHours(); byHour[k] = (byHour[k] || 0) + 1; }
console.log('\nEvents by UTC hour:');
const max = Math.max(...Object.values(byHour));
for (const k of Object.keys(byHour).map(Number).sort((a, b) => a - b))
  console.log(` ${String(k).padStart(2, '0')}:00 UTC ${'█'.repeat(Math.round(byHour[k] / max * 40)).padEnd(40)} ${byHour[k]}`);

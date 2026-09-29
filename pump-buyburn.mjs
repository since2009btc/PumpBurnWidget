#!/usr/bin/env node
/**
 * pump-buyburn.mjs — pulls pump.fun's actual buy & burn transactions from the chain.
 *
 * Addresses (published by pump.fun at https://pump.fun/pump-token):
 *   burner A: 99mRw3EzdJZWEUjgp1nrU4WeHsukUBjbh7gYE7pm4F3c
 *   burner B: 9jHrTCwpDANHLNQz5cem6XLUBM8KiTWKe766Br6KVCXM
 *   mint PUMP (Token-2022): pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
 *
 * Usage:
 *   node pump-buyburn.mjs --hours 6 --out buyburn.csv
 *   RPC=https://mainnet.helius-rpc.com/?api-key=XXX node pump-buyburn.mjs --hours 72
 *
 * Note: the public RPC is rate-limited and does not keep full history.
 * Going back weeks or months needs an RPC with history (Helius, Triton, QuickNode).
 */

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const MINT = 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
const BURNERS = [
  '99mRw3EzdJZWEUjgp1nrU4WeHsukUBjbh7gYE7pm4F3c',
  '9jHrTCwpDANHLNQz5cem6XLUBM8KiTWKe766Br6KVCXM',
];

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const HOURS = parseFloat(opt('hours', '6'));
const OUT = opt('out', 'buyburn.csv');
const CONC = parseInt(opt('conc', process.env.RPC ? '10' : '2'), 10);
// global throttle, requests/second (the public RPC tolerates ~5/s, paid providers far more)
const RPS = parseFloat(opt('rps', process.env.RPC ? '50' : '5'));
const since = Math.floor(Date.now() / 1000) - HOURS * 3600;

let calls = 0, skipped = 0, nextSlot = 0;
async function gate() {                      // token bucket: at most RPS requests/second
  const gap = 1000 / RPS;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}
async function rpc(method, params, tries = 8) {
  for (let a = 0; a < tries; a++) {
    await gate();
    try {
      const r = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params }),
      });
      if (r.status === 429 || r.status >= 500) { nextSlot = Date.now() + 1000 * 2 ** a; continue; }
      const j = await r.json();
      if (j.error) { if (j.error.code === -32004 || j.error.code === -32009) return null; await sleep(400 * 2 ** a); continue; }
      return j.result;
    } catch { await sleep(400 * 2 ** a); }
  }
  if (method === 'getTransaction') { skipped++; return null; }   // don't fail the whole run
  throw new Error(`RPC ${method} failed after ${tries} attempts`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function signaturesSince(addr) {
  const out = [];
  let before;
  for (;;) {
    const page = await rpc('getSignaturesForAddress', [addr, { limit: 1000, ...(before && { before }) }]);
    if (!page?.length) break;
    for (const s of page) if (s.blockTime >= since) out.push(s);
    const last = page[page.length - 1];
    before = last.signature;
    if (last.blockTime < since) break;
    process.stderr.write(`\r  ${addr.slice(0, 6)}… ${out.length} signatures`);
  }
  process.stderr.write(`\r  ${addr.slice(0, 6)}… ${out.length} signatures\n`);
  return out;
}

/** Classify a tx: BURN (burnChecked on the PUMP mint) or BUY (SOL out, PUMP in). */
function classify(tx, wallet) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction.message.accountKeys.map(k => k.pubkey);
  const t = tx.blockTime;
  const sig = tx.transaction.signatures[0];

  const all = [
    ...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions ?? []).flatMap(i => i.instructions),
  ];
  const burns = all.filter(i =>
    (i.parsed?.type === 'burn' || i.parsed?.type === 'burnChecked') &&
    i.parsed?.info?.mint === MINT);

  if (burns.length) {
    const pump = burns.reduce((a, i) =>
      a + Number(i.parsed.info.tokenAmount?.amount ?? i.parsed.info.amount) / 1e6, 0);
    return { kind: 'BURN', t, sig, wallet, pump, sol: 0 };
  }

  const bal = m => (m ?? []).filter(b => b.mint === MINT && b.owner === wallet)
    .reduce((a, b) => a + Number(b.uiTokenAmount.uiAmount ?? 0), 0);
  const pumpIn = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
  const i = keys.indexOf(wallet);
  const solDelta = i === -1 ? 0 : (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9;
  const solOut = -solDelta - tx.meta.fee / 1e9;   // excludes the network fee

  if (pumpIn > 0 && solOut > 0) return { kind: 'BUY', t, sig, wallet, pump: pumpIn, sol: solOut };
  return null;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let idx = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
      if (++done % 25 === 0) process.stderr.write(`\r  ${done}/${items.length} tx`);
    }
  }));
  process.stderr.write(`\r  ${items.length}/${items.length} tx\n`);
  return out;
}

const fmt = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

(async () => {
  console.error(`RPC: ${RPC.replace(/api-key=.*/, 'api-key=***')}`);
  console.error(`Window: last ${HOURS}h (since ${new Date(since * 1000).toISOString()})\n`);

  const supply = await rpc('getTokenSupply', [MINT]);
  const circ = supply.value.uiAmount;

  console.error('Collecting signatures…');
  const sigs = [];
  for (const b of BURNERS) for (const s of await signaturesSince(b)) sigs.push({ ...s, wallet: b });
  const ok = sigs.filter(s => !s.err);
  console.error(`\nDownloading ${ok.length} transactions (${RPS} req/s, concurrency ${CONC})…`);

  const rows = (await mapLimit(ok, CONC, async s => {
    const tx = await rpc('getTransaction', [s.signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    return classify(tx, s.wallet);
  })).filter(Boolean).sort((a, b) => a.t - b.t);

  const buys = rows.filter(r => r.kind === 'BUY');
  const burns = rows.filter(r => r.kind === 'BURN');
  const solSpent = buys.reduce((a, r) => a + r.sol, 0);
  const pumpBought = buys.reduce((a, r) => a + r.pump, 0);
  const pumpBurned = burns.reduce((a, r) => a + r.pump, 0);

  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, 'timestamp_utc,kind,wallet,sol_spent,pump_amount,signature\n' +
    rows.map(r => [new Date(r.t * 1000).toISOString(), r.kind, r.wallet,
      r.sol.toFixed(9), r.pump.toFixed(6), r.sig].join(',')).join('\n') + '\n');

  console.log(`
=== PUMP buy & burn — last ${HOURS}h ===
Current PUMP supply : ${fmt(circ)}  (burned so far: ${fmt(1e12 - circ)} = ${((1 - circ / 1e12) * 100).toFixed(2)}% of 1T)

BUY   : ${buys.length} tx | ${fmt(solSpent)} SOL spent | ${fmt(pumpBought)} PUMP bought
        average price: ${(solSpent / pumpBought * 1e9).toFixed(2)} lamports/PUMP
BURN  : ${burns.length} tx | ${fmt(pumpBurned)} PUMP burned
Delta : ${fmt(pumpBought - pumpBurned)} PUMP bought but not yet burned

${skipped ? `\n⚠️  ${skipped} tx not downloaded (rate limit / missing history): totals are a floor, not the exact figure.\n   Use an RPC with history: RPC=https://mainnet.helius-rpc.com/?api-key=... node pump-buyburn.mjs\n` : ''}
CSV: ${OUT}`);
})();

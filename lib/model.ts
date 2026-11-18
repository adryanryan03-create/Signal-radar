// Signal Radar model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// Scope, in two zones. Above the watchlist floor the board ranks exactly the watchlist:
// a large protocol the house rule left out was left out for a reason the snapshot's ten
// fields cannot show — a parent protocol whose token already trades (WBTC is wrapped
// Bitcoin, CCIP is a product of a token-bearing network) — so above the floor the house's
// product filter is trusted, not second-guessed. Below the floor the net widens: a
// protocol joins when the snapshot records no token for it (market cap, CoinGecko id and
// symbol all null) and it is not an exchange, a versioned pool of another protocol, or a
// product whose name says wrapped, staked or staking. Bridge, liquid staking and
// restaking categories stay in scope below the floor on purpose: a small independent
// bridge or staking protocol that still records no token is exactly the early find this
// radar exists to surface. Every watchlist slug is covered and the board ranks the full
// two-zone set, never a hand-picked list.
//
// Value. The anchor is not a constant anyone chose: it is the median market-cap / TVL
// multiple of the snapshot's own live-token protocols, trimmed to (0, 10] so one 400x
// outlier cannot drag it. Each pre-token protocol is then priced off that anchor:
//
//   momentum  = 1 + clamp(change_7d, -40, 80) / 100 x 0.75
//   longevity = 0.70 + 0.60 x ln(1 + age_days) / ln(1 + 1825)   (unknown age: 540 days)
//   breadth   = 1 + 0.04 x min(chains - 1, 5)
//   implied   = round(tvl_usd x anchor x momentum x longevity x breadth)
//
// Momentum rewards a protocol whose TVL is growing into a launch; longevity uses a log
// curve, so surviving the first year pre-token counts for far more than the fifth; breadth
// gives a small credit for running on more than one chain. Every multiplier is rounded to
// 4 decimal places before the implied value is computed, and the dashboard recomputes each
// row with the same arithmetic, so the page and board.json can be checked against each
// other to the dollar. No protocol name is ever special-cased.

/** One protocol exactly as the sealed snapshot carries it: ten fields, no more. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed knobs; the anchor itself is derived from the snapshot at run time. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  longevity_floor: number;
  longevity_range: number;
  longevity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.75,
  momentum_floor: -40,
  momentum_cap: 80,
  longevity_floor: 0.7,
  longevity_range: 0.6,
  longevity_days: 1825,
  unknown_age_days: 540,
  breadth_per_chain: 0.04,
  breadth_max_extra_chains: 5,
};

/** The model's version label, shown in the dashboard and stored on every board row. */
export const MODEL_VERSION = 'signal-radar-3';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step before it is flattened to the board's string form. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    anchor_multiple: number;
    momentum_multiplier: number;
    longevity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one board row; farm plans are regenerated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  momentum_multiplier: number;
  longevity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so its market cap is a fact, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  anchor_multiple: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot cannot be scored by this model. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The anchor multiple: the median market-cap / TVL of the snapshot's live-token protocols,
 * keeping only multiples in (0, 10] so broken records and extreme outliers cannot move it.
 * Falls back to 0.2 when a snapshot carries no usable live multiple at all.
 */
export function anchorMultiple(snapshot: Snapshot): number {
  const multiples: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const m = p.mcap_usd / p.tvl_usd;
    if (m > 0 && m <= 10) multiples.push(m);
  }
  if (multiples.length === 0) return 0.2;
  multiples.sort((a, b) => a - b);
  const mid = Math.floor(multiples.length / 2);
  const median = multiples.length % 2 === 1 ? multiples[mid]! : (multiples[mid - 1]! + multiples[mid]!) / 2;
  return round4(median);
}

/** The three multipliers and the implied value one protocol earns under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  anchor: number,
  model: ModelConstants = MODEL,
): { implied: number; momentumMult: number; longevityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growth = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawGrowth));
  const momentumMult = round4(1 + (growth / 100) * model.momentum_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const longevityMult = round4(
    model.longevity_floor + model.longevity_range * (Math.log(1 + Math.max(0, ageForModel)) / Math.log(1 + model.longevity_days)),
  );
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra_chains);
  const breadthMult = round4(1 + model.breadth_per_chain * extraChains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * anchor * momentumMult * longevityMult * breadthMult));
  return { implied, momentumMult, longevityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of some other asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a product may begin with; an exchange balance is not a launch candidate. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether the snapshot records no token for a protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is in the board's scope: pre-token and not an exchange, pool or product. */
export function inScope(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** The ranked board: the two-zone scope, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const anchor = anchorMultiple(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => inScope(p) && (watchlist.has(p.slug) || p.tvl_usd < snapshot.floor_usd))
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, anchor, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      anchor_multiple: anchor,
      momentum_multiplier: s.momentumMult,
      longevity_multiplier: s.longevityMult,
      breadth_multiplier: s.breadthMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step flattened to one board string: the action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and review it weekly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
}

/** A realistic gas figure for one transaction on a chain, from the chain's own class. */
export function gasLabel(chain: string): string {
  if (chain === 'Ethereum') return '$15';
  if (chain === 'Bitcoin') return '$3';
  if (chain === 'Solana' || chain === 'Tron' || chain === 'Algorand' || chain === 'Stellar' || chain === 'Ripple') return 'under $1';
  return '$2';
}

/** The weekly upkeep gas on a chain: mainnet costs more to revisit than a rollup or L1 with cheap fees. */
export function weeklyGasLabel(chain: string): string {
  return chain === 'Ethereum' ? '$4' : '$1';
}

/** How much capital one qualifying position needs, from the protocol's own TVL band. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 300;
  if (p.tvl_usd >= 500_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 120;
  return 60;
}

/** How long a position must be held, from the protocol's age: younger protocols qualify slower. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 540) return 60;
  if (age < 1095) return 45;
  return 30;
}

/** The category's primary farming action, in words a farmer can follow. */
export function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} so the wallet holds an active lending position`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet`;
  if (c.includes('dex') || c.includes('amm')) return `Provide $${capital} of liquidity to the main ${name} pool on ${chain} and leave the position open`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC through ${name} to ${chain} and spend a small part of it in the destination app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the native staking asset through ${name} on ${chain} and keep the receipt token`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position`;
  if (c.includes('rwa')) return `Mint $${capital} of the ${name} yield asset on ${chain} and hold it in the farming wallet`;
  if (c.includes('stable') || c.includes('basis')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it staked there`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('yield')) return `Deposit $${capital} into a ${name} yield vault on ${chain} and keep the shares`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${name} and keep the balance on the network`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** The category's second action: the step that separates a real user from a one-off depositor. */
export function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const third = Math.max(20, Math.round(capital / 3));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('curator') || c.includes('allocator')) return `Borrow a small amount against the position on ${name}, then repay half of it a week later to show two-sided use`;
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity')) return `Make three small swaps through ${name} on ${chain} on different days instead of a single large trade`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge a second $${third} back through ${name} after two weeks so both directions appear in the wallet history`;
  if (c.includes('staking') || c.includes('restak')) return `Claim or compound the staking rewards from ${name} once, and keep the receipt token in the wallet`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Open and close one small hedged trade on ${name} each month, keeping total margin under $${capital}`;
  if (c.includes('rwa') || c.includes('stable') || c.includes('basis')) return `Redeem a small part of the ${name} position once after the first month, then deposit it again a few days later`;
  if (c.includes('insurance')) return `Renew or extend the ${name} cover once before it expires so the policy history stays continuous`;
  if (c.includes('yield')) return `Move a small share of the position into a second ${name} vault on ${chain} so the activity is not a single deposit`;
  return `Use one extra feature of ${name} beyond the first deposit, such as a second market, a vote or a referral link`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own category, first chain, TVL band and age. The dashboard regenerates the same
 * plan from the same figures, so the page and board.json never drift apart.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasLabel(chain);
  return [
    {
      text: `Create a fresh wallet only for ${p.name}, back up its seed phrase offline, and never reuse it for other farms`,
      cost: 'no purchase, just the wallet itself',
      time: '10 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital plus about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, capital, chain),
      cost: `about ${gas} of gas for each extra action`,
      time: '20 minutes spread over the first month',
    },
    {
      text: `Repeat one small qualifying action on ${p.name} every week, such as a top-up, a swap, a borrow or a claim check`,
      cost: `about ${weeklyGasLabel(chain)} of gas each week`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the wallet appears in several weekly activity snapshots`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days of holding`,
    },
    {
      text: `Check the official ${p.name} announcements and points page before withdrawing, and claim only through links the protocol itself publishes`,
      cost: 'free to check, and never pay a third party to claim',
      time: '10 minutes',
    },
    {
      text: `Record every transaction hash, date and balance for ${p.name} in a farm log, and set a reminder to review the position monthly`,
      cost: 'nothing beyond the log itself',
      time: '5 minutes to log each action',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js; the page regenerates its farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    momentum_multiplier: row.model.momentum_multiplier,
    longevity_multiplier: row.model.longevity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** The board and everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    anchor_multiple: anchorMultiple(snapshot),
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot parsed out of a file's text, refused unless it has the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board fails the gate, or null: coverage, ranks, value order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

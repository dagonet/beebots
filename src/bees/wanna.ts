// wanna-bee: contrarian momentum. Longs rising-volume 7-day leaders where shorts pay funding, shorts rising-volume
// laggards where longs pay. Code takes half at +6%, trails the rest and closes the moment funding flips.
// See strategies/WANNA_BEE.md.
import type { CoinStats, MarketView } from "../market/types.js";
import { zs } from "./boozy.js";
import { r2 } from "./common.js";
import type { BeeBrain, BeeContext, ForcedExit, Menu, Side } from "./types.js";

/** Funding (% per 8h) must favour the side by at least this much to enter; the exit is the bare sign flip. */
export const WANNA_FUNDING_EDGE_PCT = 0.002;
/** Take half off once the mark is this far (%) past the average entry. */
export const WANNA_TAKE_HALF_PCT = 6;
/** Enter at 1x equity (half of the 2x max). No adds. */
const ENTRY_FRAC = 0.5;
/** Leaders = top 20% of the ranked pool, laggards = bottom 20%, at least 5 coins each. */
const BUCKET = 0.2;
const BUCKET_MIN = 5;
const PER_SIDE = 4;
/** After the half: trail 3 x ATR(1h) behind the mark, never below break-even. */
const TRAIL_ATR1H = 3;
/** CLOSE needs the held coin to fail the filters on this many market refreshes in a row (one blip is not a reason). */
export const WANNA_OFF_REFRESHES = 3;
/** A switch needs the new coin this much stronger (momentum z-score) than the held one: no ping-pong on near-ties. */
export const WANNA_SWITCH_GAP = 0.5;

/** 1h ATR in % of price, approximated as 2 x the 15m ATR (as Momentum does). */
const atr1hPct = (s: CoinStats | undefined) => (s && s.atr14Pct !== null ? s.atr14Pct * 2 : null);

/** Stop distance in %: 7 at a typical 1.5% hourly swing, 6 on calm coins, 8 on jumpy ones, 7 when unknown. */
export function wannaStopPct(s: CoinStats | undefined): number {
  const a = atr1hPct(s);
  if (a === null || !Number.isFinite(a)) return 7;
  return Math.min(8, Math.max(6, 4 + 2 * a));
}

export interface WannaEntry {
  s: CoinStats;
  side: Side;
  score: number;
}

/** Every coin that passes the filters (uncapped), plus each pool coin's momentum score. */
function eligible(view: MarketView, spreadGateBps: number): { longs: WannaEntry[]; shorts: WannaEntry[]; score: Map<string, number> } {
  const pool = view.gated
    .map((id) => view.stats.get(id))
    .filter((s): s is CoinStats => !!s && s.ret7dPct !== null && s.ret24hPct !== null && s.spreadBp <= spreadGateBps);
  if (!pool.length) return { longs: [], shorts: [], score: new Map() };
  const z7 = zs(pool.map((s) => s.ret7dPct!));
  const z24 = zs(pool.map((s) => s.ret24hPct!));
  const ranked = pool.map((s) => ({ s, score: z7(s.ret7dPct!) + 0.1 * z24(s.ret24hPct!) })).sort((a, b) => b.score - a.score);
  const n = Math.max(BUCKET_MIN, Math.ceil(ranked.length * BUCKET));
  const rising = (s: CoinStats) => s.volZ !== null && s.volZ > 0;
  const longs = ranked
    .slice(0, n)
    .filter((c) => rising(c.s) && c.s.fundingPct !== null && c.s.fundingPct <= -WANNA_FUNDING_EDGE_PCT)
    .map((c) => ({ ...c, side: "long" as const }));
  const shorts = ranked
    .slice(-n)
    .reverse()
    .filter((c) => rising(c.s) && c.s.fundingPct !== null && c.s.fundingPct >= WANNA_FUNDING_EDGE_PCT)
    .map((c) => ({ ...c, side: "short" as const }));
  return { longs, shorts, score: new Map(ranked.map((c) => [c.s.instId, c.score])) };
}

/** Eligible longs (best first) and shorts (weakest first): rising volume, funding on the bee's side. */
export function wannaEntries(view: MarketView, spreadGateBps: number): { longs: WannaEntry[]; shorts: WannaEntry[] } {
  const e = eligible(view, spreadGateBps);
  return { longs: e.longs.slice(0, PER_SIDE), shorts: e.shorts.slice(0, PER_SIDE) };
}

const entries = (ctx: BeeContext) => {
  const { longs, shorts } = wannaEntries(ctx.view, ctx.knobs.spreadGateBps);
  return [...longs, ...shorts];
};

/** Strength on the bee's side: the momentum score for a long, minus it for a short. */
const strength = (side: Side, score: number) => (side === "long" ? score : -score);

/** The held coin still passes the filters on its side (anywhere in its bucket, not only the top 4 on the menu). */
function stillQualifies(ctx: BeeContext): boolean {
  const p = ctx.bee.position;
  if (!p) return false;
  const e = eligible(ctx.view, ctx.knobs.spreadGateBps);
  return (p.side === "long" ? e.longs : e.shorts).some((x) => x.s.instId === p.instId);
};

export const wanna: BeeBrain = {
  id: "wanna",
  neverForce: true,
  strategy:
    "You are wanna-bee, the contrarian. Momentum with a funding edge: go long the week's strongest coins while their volume is rising and shorts are paying funding, go short the weakest while their volume is rising and longs are paying. Every coin on your menu already has funding on its side; prefer the one where funding is most stretched against the crowd (fund_pct, fund_z). WAIT unless a setup convinces you. No holding period and no loyalty: switch the moment a clearly better leader or laggard shows up. CLOSE is only offered once your coin no longer qualifies. The code sets a 6-8% stop, takes half off at +6%, trails the rest, and closes the moment funding flips against you.",
  convictionLabels: ["meh", "keen", "eager", "all-in"],

  universe(ctx) {
    return entries(ctx).map((e) => e.s.instId);
  },

  snapshotCoins(ctx) {
    const ids = entries(ctx).map((e) => e.s.instId);
    const p = ctx.bee.position;
    if (p && !ids.includes(p.instId)) ids.push(p.instId);
    return ids;
  },

  coinSnapshot(s) {
    return {
      r1h_pct: r2(s.ret1hPct, 1),
      r24h_pct: r2(s.ret24hPct, 0),
      r7d_pct: r2(s.ret7dPct, 0),
      vol_z: r2(s.volZ, 1),
      fund_pct: r2(s.fundingPct, 4),
      fund_z: r2(s.fundingZ, 1),
      spread_bp: r2(s.spreadBp, 0),
      vol_musd: r2(s.vol24hUsd / 1e6, 1),
    };
  },

  menu(ctx) {
    const p = ctx.bee.position;
    const all = entries(ctx);
    const m: Menu = {};
    // The exits are code's (stop, half at +6%, trail, funding flip). A plain CLOSE every tick was a coin toss (4 Oct:
    // six ZEC shorts closed within 20 s), and a CLOSE on the first failed check flickered with the data (4 Oct: ENA
    // closed five times in 20 min), so it needs the coin off the filters for WANNA_OFF_REFRESHES refreshes in a row.
    const off = !!p && (p.offStreak ?? 0) >= WANNA_OFF_REFRESHES;
    // While the held coin still counts, only a clearly stronger coin is worth a switch (5 Oct: ZEC <-> TAO ping-pong).
    const heldScore = p ? eligible(ctx.view, ctx.knobs.spreadGateBps).score.get(p.instId) : undefined;
    const worthSwitching = (e: WannaEntry) => off || (!!p && heldScore !== undefined && strength(e.side, e.score) >= strength(p.side, heldScore) + WANNA_SWITCH_GAP);
    if (p) {
      m.HOLD = { desc: "keep position", intent: { kind: "hold" } };
      if (off) m.CLOSE = { desc: `${p.coin} no longer qualifies, close`, intent: { kind: "close", reason: "no_longer_qualifies" } };
    }
    for (const e of all) {
      if (p && (e.s.instId === p.instId || !worthSwitching(e))) continue;
      const label = `${e.side.toUpperCase()}_${e.s.coin}`;
      m[label] = p
        ? { desc: `close ${p.coin}, ${e.side} ${e.s.coin}`, intent: { kind: "switch", instId: e.s.instId, side: e.side, sizeFrac: ENTRY_FRAC, setup: "strict" } }
        : { desc: null, intent: { kind: "open", instId: e.s.instId, side: e.side, sizeFrac: ENTRY_FRAC, setup: "strict" } };
    }
    // Flat with something on offer: Jev may decline (a lone entry used to be a forced pick).
    if (!p && all.length) m.WAIT = { desc: "no setup convinces, keep waiting", intent: { kind: "hold" } };
    return m;
  },

  afterRefresh(ctx) {
    const p = ctx.bee.position;
    if (!p) return;
    p.offStreak = stillQualifies(ctx) ? 0 : (p.offStreak ?? 0) + 1;
  },

  forcedEntry() {
    return null;
  },

  sizeFrac(intent) {
    // Always 1x equity; the size never depends on conviction.
    return intent.sizeFrac;
  },

  stopFor(instId, side, entryPx, ctx) {
    const pct = wannaStopPct(ctx.view.stats.get(instId)) / 100;
    return side === "long" ? entryPx * (1 - pct) : entryPx * (1 + pct);
  },

  trail(ctx) {
    const p = ctx.bee.position;
    const s = p ? ctx.view.stats.get(p.instId) : undefined;
    if (!p || !p.halfTaken || !s) return null;
    const a = atr1hPct(s);
    const dist = a === null ? 0 : (s.mid * a * TRAIL_ATR1H) / 100;
    return p.side === "long" ? Math.max(p.entryPx, s.mid - dist) : Math.min(p.entryPx, s.mid + dist);
  },

  forcedExit(ctx): ForcedExit | null {
    const p = ctx.bee.position;
    const s = p ? ctx.view.stats.get(p.instId) : undefined;
    if (!p || !s) return null;
    const f = s.fundingPct;
    if (f !== null && (p.side === "long" ? f > 0 : f < 0)) {
      return { intent: { kind: "close", reason: "funding_flip" }, reason: "funding_flip", status: `funding flipped on ${p.coin} (${f.toFixed(4)}%): closed` };
    }
    const gainPct = p.entryPx > 0 ? ((p.side === "long" ? 1 : -1) * (s.mid - p.entryPx) * 100) / p.entryPx : 0;
    if (!p.halfTaken && gainPct >= WANNA_TAKE_HALF_PCT) {
      return { intent: { kind: "trim", fraction: 0.5 }, reason: "take_half", status: `took half off ${p.coin} at +${gainPct.toFixed(1)}%` };
    }
    return null;
  },

  idleStatus() {
    return "waiting: no leader or laggard with funding on its side";
  },
};

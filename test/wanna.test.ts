import { describe, expect, it } from "vitest";
import { customBrain, deriveStyle } from "../src/bees/custom.js";
import { wanna, wannaEntries, wannaStopPct } from "../src/bees/wanna.js";
import { bee, coin, ctx, position, view } from "./fixtures.js";

// Ten coins, strongest first. Leaders = top 5, laggards = bottom 5 (20% bucket, minimum 5).
const lead = (name: string, r7: number, over = {}) => coin(name, { ret7dPct: r7, ret24hPct: r7 / 4, volZ: 1, fundingPct: -0.01, ...over });
const lag = (name: string, r7: number, over = {}) => coin(name, { ret7dPct: r7, ret24hPct: r7 / 4, volZ: 1, fundingPct: 0.01, ...over });
const market = (over: Record<string, object> = {}) =>
  view([
    lead("AAA", 50, over.AAA), lead("BBB", 40, over.BBB), lead("CCC", 30, over.CCC), lead("DDD", 20, over.DDD), lead("EEE", 10, over.EEE),
    lag("VVV", -10, over.VVV), lag("WWW", -20, over.WWW), lag("XXX", -30, over.XXX), lag("YYY", -40, over.YYY), lag("ZZZ", -50, over.ZZZ),
  ]);
const labels = (m: object) => Object.keys(m).sort();
const c = (b = bee("wanna"), v = market()) => ctx("wanna", b, v);

describe("wanna: entries", () => {
  it("longs the best 4 leaders and shorts the weakest 4 laggards", () => {
    const { longs, shorts } = wannaEntries(market(), 15);
    expect(longs.map((e) => e.s.coin)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(shorts.map((e) => e.s.coin)).toEqual(["ZZZ", "YYY", "XXX", "WWW"]);
    expect(longs.every((e) => e.side === "long") && shorts.every((e) => e.side === "short")).toBe(true);
  });

  it("needs rising volume", () => {
    const { longs } = wannaEntries(market({ AAA: { volZ: 0 }, BBB: { volZ: null } }), 15);
    expect(longs.map((e) => e.s.coin)).toEqual(["CCC", "DDD", "EEE"]);
  });

  it("needs funding on its side by at least 0.002 %/8h; unknown funding never qualifies", () => {
    const v = market({ AAA: { fundingPct: -0.0019 }, BBB: { fundingPct: 0 }, CCC: { fundingPct: null }, DDD: { fundingPct: -0.002 }, ZZZ: { fundingPct: 0.0019 }, YYY: { fundingPct: 0.002 } });
    const { longs, shorts } = wannaEntries(v, 15);
    expect(longs.map((e) => e.s.coin)).toEqual(["DDD", "EEE"]);
    expect(shorts.map((e) => e.s.coin)).toEqual(["YYY", "XXX", "WWW", "VVV"]);
  });

  it("a leader is never shorted and a laggard is never longed", () => {
    const v = market({ AAA: { fundingPct: 0.05 }, ZZZ: { fundingPct: -0.05 } });
    const { longs, shorts } = wannaEntries(v, 15);
    expect(longs.map((e) => e.s.coin)).not.toContain("ZZZ");
    expect(shorts.map((e) => e.s.coin)).not.toContain("AAA");
  });

  it("respects the spread gate", () => {
    expect(wannaEntries(market({ AAA: { spreadBp: 16 } }), 15).longs.map((e) => e.s.coin)).not.toContain("AAA");
  });
});

describe("wanna: menu", () => {
  it("flat: every eligible entry as an open at 1x equity, plus WAIT so Jev can say no", () => {
    const m = wanna.menu(c());
    expect(labels(m)).toEqual(["LONG_AAA", "LONG_BBB", "LONG_CCC", "LONG_DDD", "SHORT_WWW", "SHORT_XXX", "SHORT_YYY", "SHORT_ZZZ", "WAIT"]);
    expect(m.LONG_AAA!.intent).toMatchObject({ kind: "open", side: "long", sizeFrac: 0.5, setup: "strict" });
    expect(m.SHORT_ZZZ!.intent).toMatchObject({ kind: "open", side: "short" });
    expect(m.WAIT!.intent).toEqual({ kind: "hold" });
  });

  it("flat with a single eligible coin: that entry and WAIT (4 Oct: a lone SHORT_ZEC was a forced pick)", () => {
    const only = view([lag("ZEC", -20), coin("BTC", { ret7dPct: 1, ret24hPct: 0.2, volZ: -1 })]);
    expect(labels(wanna.menu(c(bee("wanna"), only)))).toEqual(["SHORT_ZEC", "WAIT"]);
  });

  it("flat with nothing eligible: an empty menu, not a lone WAIT", () => {
    expect(wanna.menu(c(bee("wanna"), market({ VVV: { volZ: 0 }, WWW: { volZ: 0 }, XXX: { volZ: 0 }, YYY: { volZ: 0 }, ZZZ: { volZ: 0 }, AAA: { volZ: 0 }, BBB: { volZ: 0 }, CCC: { volZ: 0 }, DDD: { volZ: 0 }, EEE: { volZ: 0 } })))).toEqual({});
  });

  it("holding a coin that still qualifies: HOLD and a switch to every other eligible coin, no CLOSE (code owns the exits)", () => {
    const v = market();
    const aaa = v.stats.get("AAA-USD_UM_XPERP-310404")!;
    const m = wanna.menu(c(bee("wanna", { position: position(aaa), flatSince: null }), v));
    expect(m.HOLD!.intent).toEqual({ kind: "hold" });
    expect(m.CLOSE).toBeUndefined();
    expect(m.LONG_AAA).toBeUndefined();
    expect(m.LONG_BBB!.intent).toMatchObject({ kind: "switch", side: "long" });
    expect(m.SHORT_ZZZ!.intent).toMatchObject({ kind: "switch", side: "short" });
  });

  it("holding the only qualifying coin: HOLD alone, so the rules hold without asking Jev", () => {
    const only = view([lag("ZEC", -20), coin("BTC", { ret7dPct: 1, ret24hPct: 0.2, volZ: -1 })]);
    const zec = only.stats.get("ZEC-USD_UM_XPERP-310404")!;
    expect(labels(wanna.menu(c(bee("wanna", { position: position(zec, { side: "short" }), flatSince: null }), only)))).toEqual(["HOLD"]);
  });

  it("holding a coin that no longer qualifies (volume faded): CLOSE is offered", () => {
    const v = market({ AAA: { volZ: -0.5 } });
    const aaa = v.stats.get("AAA-USD_UM_XPERP-310404")!;
    const m = wanna.menu(c(bee("wanna", { position: position(aaa), flatSince: null }), v));
    expect(m.CLOSE!.intent).toMatchObject({ kind: "close" });
    expect(m.HOLD).toBeDefined();
  });

  it("holding a coin missing from the market data: HOLD and CLOSE are still offered", () => {
    const gone = coin("GONE", {});
    const m = wanna.menu(c(bee("wanna", { position: position(gone), flatSince: null })));
    expect(m.HOLD).toBeDefined();
    expect(m.CLOSE).toBeDefined();
  });

  it("is never forced in while flat", () => {
    expect(wanna.neverForce).toBe(true);
    expect(wanna.forcedEntry(c())).toBeNull();
  });
});

describe("wanna: stops", () => {
  it("6-8 %, 7 % at a typical swing or when unknown", () => {
    expect(wannaStopPct(coin("A", { atr14Pct: 0.75 }))).toBeCloseTo(7, 9); // ATR1h 1.5 %
    expect(wannaStopPct(coin("A", { atr14Pct: 0.1 }))).toBe(6);
    expect(wannaStopPct(coin("A", { atr14Pct: 3 }))).toBe(8);
    expect(wannaStopPct(coin("A", { atr14Pct: null }))).toBe(7);
    expect(wannaStopPct(undefined)).toBe(7);
  });

  it("stopFor sits below a long and above a short", () => {
    const v = market({ AAA: { atr14Pct: 0.75 } });
    const id = "AAA-USD_UM_XPERP-310404";
    expect(wanna.stopFor(id, "long", 100, c(bee("wanna"), v))).toBeCloseTo(93, 9);
    expect(wanna.stopFor(id, "short", 100, c(bee("wanna"), v))).toBeCloseTo(107, 9);
  });

  it("trail: nothing before the half; after it, at least break-even and 3 x ATR(1h) behind the mark", () => {
    const s = coin("AAA", { atr14Pct: 0.5 }, 110); // ATR1h 1 % of 110 = 1.1
    const v = view([s]);
    expect(wanna.trail!(c(bee("wanna", { position: position(s, { entryPx: 100 }), flatSince: null }), v))).toBeNull();
    const after = (entryPx: number, side: "long" | "short") => wanna.trail!(c(bee("wanna", { position: position(s, { entryPx, side, halfTaken: true }), flatSince: null }), v));
    expect(after(100, "long")).toBeCloseTo(110 - 3.3, 9);
    expect(after(109, "long")).toBe(109); // break-even floor
    expect(after(120, "short")).toBeCloseTo(110 + 3.3, 9);
    expect(after(111, "short")).toBe(111);
  });

  it("trail is null when the held coin has no market data", () => {
    const gone = coin("GONE", {});
    expect(wanna.trail!(c(bee("wanna", { position: position(gone, { halfTaken: true }), flatSince: null })))).toBeNull();
  });
});

describe("wanna: forced exits", () => {
  const held = (over: object, posOver: object = {}, px = 100) => {
    const s = coin("AAA", { fundingPct: -0.01, ...over }, px);
    return c(bee("wanna", { position: position(s, { entryPx: 100, ...posOver }), flatSince: null }), view([s]));
  };

  it("closes a long when funding turns positive, and a short when it turns negative", () => {
    expect(wanna.forcedExit!(held({ fundingPct: 0.0001 }))).toMatchObject({ intent: { kind: "close", reason: "funding_flip" }, reason: "funding_flip" });
    expect(wanna.forcedExit!(held({ fundingPct: -0.0001 }, { side: "short" }))?.reason).toBe("funding_flip");
    expect(wanna.forcedExit!(held({ fundingPct: 0 }))).toBeNull(); // exactly zero is not a flip
  });

  it("takes half once at +6 %, not below, not twice", () => {
    expect(wanna.forcedExit!(held({}, {}, 106))).toMatchObject({ intent: { kind: "trim", fraction: 0.5 }, reason: "take_half" });
    expect(wanna.forcedExit!(held({}, {}, 105.9))).toBeNull();
    expect(wanna.forcedExit!(held({}, { halfTaken: true }, 110))).toBeNull();
    expect(wanna.forcedExit!(held({ fundingPct: 0.01 }, { side: "short" }, 94))?.reason).toBe("take_half");
  });

  it("the funding flip wins over take-half", () => {
    expect(wanna.forcedExit!(held({ fundingPct: 0.01 }, {}, 110))?.reason).toBe("funding_flip");
  });

  it("unknown funding: no flip exit, take-half still works", () => {
    expect(wanna.forcedExit!(held({ fundingPct: null }))).toBeNull();
    expect(wanna.forcedExit!(held({ fundingPct: null }, {}, 107))?.reason).toBe("take_half");
  });

  it("no exit when flat or when the held coin has no market data", () => {
    expect(wanna.forcedExit!(c())).toBeNull();
    const gone = coin("GONE", {});
    expect(wanna.forcedExit!(c(bee("wanna", { position: position(gone), flatSince: null })))).toBeNull();
  });
});

describe("wanna: as an owner-designed bee", () => {
  it("deriveStyle keeps wanna for any coin list", () => {
    expect(deriveStyle("wanna", [])).toBe("wanna");
    expect(deriveStyle("wanna", ["BTC"])).toBe("wanna");
  });

  it("customBrain keeps the forced exits, trail and never-force", () => {
    const b = customBrain(wanna, { coins: [], rules: "Rotate freely." });
    expect(b.forcedExit).toBe(wanna.forcedExit);
    expect(b.trail).toBe(wanna.trail);
    expect(b.neverForce).toBe(true);
    expect(b.strategy).toContain("Owner's rules for this bee");
  });
});

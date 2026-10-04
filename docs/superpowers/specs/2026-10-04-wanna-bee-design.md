# Wanna Bee: a "Contrarian Momentum" style — design

Date: 2026-10-04 · Branch: `wanna-bee` · Status: approved in chat, awaiting spec review

## Goal

Replace the slot-2 bee (Honey Break, Breakout style, no trade in 4 days) with an owner-designed bee, **Wanna Bee**,
whose rules the existing styles cannot express. The owner's rules, verbatim:

> Momentum + funding edge: long the strongest 7-day leaders with rising volume, short the weakest laggards, and always
> prefer the side where funding is stretched against the crowd. Hard stop 6-8%, take half at +6%, trail the rest.
> Exit if funding flips against the position. Rotate freely between leaders - no holding period, no loyalty to a coin.

Owner rules on the existing styles only steer Jev's pick among the moves a style offers (`src/bees/custom.ts`); they
cannot add shorts to Momentum, remove its 24h lock, or change stops. So this needs a new built-in style.

**Success:** Wanna Bee paper-trades in slot 2 with every rule below enforced; Calm Canopy (slot 1) and Hexchaser
(slot 3) keep their positions, history and behaviour unchanged; the full test suite, typecheck and lint pass.

## Decisions (owner-approved)

| Topic | Decision |
|---|---|
| Funding flip (exit) | **Sign flip.** A long exits when funding turns > 0; a short exits when it turns < 0. |
| Entry vs funding | Enter only where funding clearly favours the side: long needs funding ≤ −0.002 %/8h, short needs ≥ +0.002 %/8h. (Follows from the exit rule; the dead band avoids churn on coins sitting at ~0.) Consequence: mostly short, since most coins carry positive funding. |
| Stop | 6–8 %, 7 % at a typical swing: `stopPct = clamp(4 + 2 × atr1hPct, 6, 8)`, 7 % when ATR is unknown. Fixed at entry. |
| Take profit | When the best price since entry is ≥ +6 % from average entry, close half (once). |
| Trail the rest | After the half is taken: stop ≥ break-even (average entry), and trails 3 × ATR(1h) behind the mark. Ratchet only (engine rule). No trailing before the half. |
| Size | 1 × equity (0.5 of max notional, ≈ $323 on $333). No adds. |
| Rotation | No holding period: close or switch to any eligible coin on any tick. Brakes: 6 trades/day, $3 fee budget/day, 5 min cooldown after an order. |
| Forcing | Never forced in while flat (`neverForce`); no rule asks it to always hold. |
| Slot | Replaces slot 2 with a fresh $333 and empty history. Slots 1 and 3 untouched. |
| Deployment | Own engine build from this branch; web and backup images stay official. |

## Design

### 1. New brain: `src/bees/wanna.ts` (style id `wanna`)

**Ranking.** Pool = gated universe (`view.gated`) with `spreadBp ≤ WANNA_SPREAD_GATE_BPS`, `ret7dPct` known.
Score = z(7d return) + 0.1 × z(24h return) (Momentum's ranking without the attention bonus).
- **Leaders:** top 20 % of the pool by score (at least 5 coins).
- **Laggards:** bottom 20 % (at least 5 coins).
- **Rising volume:** `volZ > 0` (last hour's volume above its 7-day hourly mean).

**Eligible entries.**
- `LONG_<coin>`: a leader, rising volume, `fundingPct ≤ −0.002`. Best 4 by score.
- `SHORT_<coin>`: a laggard, rising volume, `fundingPct ≥ +0.002`. Weakest 4.
- Coins with unknown funding or volume are never eligible.

**Menu.**
- Flat: every eligible `LONG_*` / `SHORT_*` (open intents, `setup: "strict"`). Empty menu = wait (idle status
  "no leader or laggard with funding on its side").
- Holding: `HOLD`, `CLOSE`, and every eligible entry on a different coin as a switch intent.

**Jev sees** per coin: 1h/24h/7d return, volume z, funding % and its 30-day z, spread, 24h volume; plus the shared bee
line. Strategy text summarises the rules above; the owner's rules are appended by `customBrain` as for every Setup bee.
Conviction labels: `["meh", "keen", "eager", "all-in"]` (display only; size is fixed).

**Stops.** `stopFor`: the stop % above from the entry price. `trail`: null until `position.halfTaken`, then
`max(entry, mark − 3 × ATR1h)` for a long (mirror for a short). ATR(1h) ≈ 2 × the 15 m ATR, as in Momentum.

### 2. New risk hook: `BeeBrain.forcedExit` (generic, optional)

`forcedExit?(ctx): { intent: close | trim; reason: string; status: string } | null`, evaluated in `applyRisk`
step 2, right after the code stop and time stop, so it fires whatever Jev says, when Jev is down, and while benched.
Wanna's implementation, in order:
1. Funding sign flipped against the position → close, reason `funding_flip`.
2. `!halfTaken` and best price ≥ +6 % from average entry → trim 0.5, reason `take_half`.

Brains without the hook are unaffected (existing behaviour byte-for-byte).

### 3. Engine and position state

- `Position.halfTaken?: boolean`. The engine sets it after a successful trim (any brain; only Wanna reads it), and
  `peakPx` is tracked for Wanna as it is for profit-lock brains.
- No other engine change. Forced trims count against the fee budget like any order; trade cap counts opens only (as today).

### 4. Style registry and config

- `STYLES` gains `wanna`; `STYLE_INFO.wanna = { label: "Contrarian Momentum", name: "Contra", tagline: "the contrarian", blurb: … }`.
  (`name` is the reserved official-bee name, so it must not be "Wanna".)
- `BRAINS.wanna`; `deriveStyle` keeps `wanna` for any coin list.
- Knobs `WANNA_*` via `perStyle`: trades 6, fee $3.00, spread 15 bp, cooldown 5 min, stop-ATR 2 (unused), max-flat 0.
  Documented in `.env.example`.
- Future Setups list the new style automatically (the OpenAI design prompt and Setup page read `STYLES`).
- Dashboard: no change (colours are per slot; the label comes from `/profile`).
- `strategies/WANNA_BEE.md`: the rules and honest expectation, like the other style docs.

### 5. Swapping one bee: `src/tools/swap-bee.ts`

Run inside the engine container with the engine stopped:
`node dist/tools/swap-bee.js --slot bee2 --name "Wanna Bee" --style wanna --tagline "the contrarian" --rules "…" [--look "…"]`
1. Copies `settings.json`, the trade DB and `bee-images/` to `/data/pre-swap-<timestamp>/`.
2. Replaces that slot in `settings.json` (validated with `SettingsSchema`), keeping keys, password, Hive choice and
   the other two bees.
3. Deletes that slot's rows from the trade DB (`bee_state`, decisions, orders, fills, funding, equity snapshots, caps,
   reconciliations), so the slot restarts at the start equity. Other slots' rows are untouched. Refuses if the slot
   has an open position unless `--force` (Honey Break is flat).
4. Paints a portrait with the stored OpenAI key via the existing `paintBee`, if a key is present; otherwise the
   dashboard shows its placeholder.

### 6. Running it

`docker-compose.override.yml` (local, untracked) adds `build: .` and `image: beebots-engine:local` to `engine`.
Upstream updates: `git pull` into `main`, merge into `wanna-bee`, rebuild.

## Testing

- `test/wanna.test.ts`: ranking and 20 % buckets; entry eligibility (volume, funding dead band, unknown funding);
  flat and holding menus (switch labels, no self-switch); stop % clamp; trail null before half, break-even floor after;
  `forcedExit` for funding flip both sides, take-half at +6 % once, nothing below +6 %.
- `test/risk.test.ts`: `forcedExit` fires over a Jev proposal, when Jev is unreachable, and while benched; a brain
  without the hook behaves as before.
- Config/settings: `WANNA_*` defaults parse; `deriveStyle("wanna", …)`; Settings accept style `wanna`.
- Swap tool: settings rewritten for one slot only; other slots' DB rows untouched; open-position refusal.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass. Then build the image, swap, and watch live on paper: Wanna Bee
  is asked by Jev each tick, its menu matches the market's funding, slots 1 and 3 keep their equity.

## Out of scope

Adds/pyramiding, conviction-based sizing, joining the Hive, live/demo trading, upstreaming the style.

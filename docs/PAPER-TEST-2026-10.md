# Paper test, 30 Sep – 10 Oct 2026

Three bees traded OKX perpetual futures with **simulated money** on a local Docker install
(`MODE=dry`, $333 per bee, 0.05% taker fee per fill, real OKX EEA market data). No exchange account was touched.
The run was stopped on 10 Oct 2026 at 10:55 UTC. Numbers come from the bees' trade database at that moment.

**Not financial advice.** Ten days of paper trading say very little about how a strategy behaves with real money.

## Result

| Bee | Style | Ran | End equity | Result | Round trips | Wins | Fees | Max drawdown |
|---|---|---|---|---|---|---|---|---|
| Calm Canopy | Trend (BTC, ETH) | 30 Sep – 10 Oct | $347.61 | **+4.4%** | 1 | 1 | $0.77 | 5.2% |
| Wanna Bee | Contrarian Momentum (custom) | 4 Oct – 10 Oct | $344.75 | **+3.5%** | 42 | 17 (40%) | $13.17 | 7.7% |
| Hexchaser | Momentum (any coin) | 30 Sep – 10 Oct | $440.49 | **+32.3%** | 23 | 13 (57%) | $8.40 | 18.7% |
| **All three** | | | **$1,132.85** | **+13.4%** on $999 | | | **$22.34** | |

Positions still open at the stop: Calm Canopy short ETH (+$14.81 open), Wanna Bee short WLD (−$1.80), Hexchaser long DOT
(−$4.07). Their open P&L is included in the equity above.

**Real money spent** (the only real cost of the test): Jev decisions **$2.54** (Calm Canopy $2.05, Hexchaser $0.45,
Wanna Bee $0.05; the $2/day cap was never hit), plus a few cents of OpenAI for designing and painting the bees.

## Per bee

### Calm Canopy — Trend, BTC and ETH

- Very few trades: 2 entries, 4 size-ups, 1 exit (a stop, +$0.16). Almost all of its +4.4% is the open ETH short.
- Asked Jev on nearly every tick (63,173 paid decisions), so it was the most expensive bee to run: its Jev bill
  ($2.05) is about a seventh of its paper gain.
- Calmest equity curve: low $330.01, high $364.54.

### Hexchaser — Momentum, any liquid coin

- The headline number rests on **one trade**: STRK, closed by the trailing stop on 9 Oct at **+$121.70**. Without it,
  its other 22 round trips net −$1.9 before fees.
- PUMP was its favourite coin (14 entries, −$8.10 overall), followed by small wins and losses on 8 other coins.
- Wildest curve: low $299.27 (−10%), high $495.97 (+49%), max drawdown 18.7%. The daily loss stop tripped twice.
- Cheap to run ($0.45 of Jev): inside its 24-hour commitment it holds without asking Jev.

### Wanna Bee — Contrarian Momentum (built during the test)

Longs strong 7-day leaders with rising volume where shorts pay funding, shorts weak laggards with rising volume where
longs pay; 6–8% stop, half off at +6%, trailing stop, closes when funding flips sign. Rules and code:
`strategies/WANNA_BEE.md`, `src/bees/wanna.ts`.

- In practice almost always **short** (most coins carry positive funding), across 17 different coins.
- Gross trading gain **+$26.42**, of which **fees took $13.17** (half). 42 round trips, 40% winners; best PONS +$14.36,
  worst ENA −$6.07.
- How its trades ended: 26 "no longer qualifies" closes, 14 switches to a stronger coin, 1 funding flip, 1 half
  taken at +6%. It used its 6 trades a day most days (trade cap hit 7 times in 6 days).
- Cheapest to run ($0.05 of Jev): when nothing better is on offer it holds without asking.

## What happened, in order

| When (UTC) | Event |
|---|---|
| 30 Sep | Local install; first design (three Momentum bees) replaced the same day by Trend / Breakout / Momentum. |
| 30 Sep – 4 Oct | **Honey Break (Breakout, BTC/ETH/SOL)**: no trade in 3.5 days, its breakout trigger never fired. |
| 4 Oct | Honey Break swapped for **Wanna Bee**, a new style written for the owner's rules (`swap-bee` tool, other bees untouched). Repo forked to `dagonet/beebots`; upstream 2026.10.02 (the Beekeeper, left off) merged. |
| 4 Oct, 10:00 | **Churn #1**: 12 orders in 30 minutes, −$2.45 ($1.91 fees). Cause: a lone entry on the menu was a forced pick, and a plain CLOSE every 10 s was a coin toss. Fix: WAIT option; CLOSE only once the coin no longer qualifies. Slot reset to $333. |
| 4–5 Oct | **Churn #2**: 23 orders in a day, −3.3%. Cause: eligibility flickered at the filter edge (ENA closed five times in 20 min) and two near-equal coins ping-ponged (ZEC ↔ TAO every 5 min). Fix: CLOSE only after 3 failed market refreshes in a row; switch only to a clearly stronger coin. |
| 6 Oct | Wanna Bee's low point: $308.16 (−7.5%). |
| 6 – 10 Oct | Wanna Bee recovers to +3.5%; Hexchaser's STRK trade on 9 Oct lifts it to +32%. |
| 10 Oct | Stopped ("testing enough for now"). |

The PC rebooted several times (planned, 07:00), so the bees were offline for short stretches; positions were not
managed during those gaps.

## Lessons

1. **Menu design decides trading frequency.** A choice Jev cannot decline, or a 50/50 choice asked every 10 seconds,
   becomes churn. Every menu should have a "do nothing" option, and an exit should need a reason that lasts.
2. **Fees are the main cost of an active bee.** Wanna Bee's fees ate half of its gross gain. A next step would be
   to enter only coins that pass the filters with a margin (not right at the edge), and/or a higher bar for switches.
3. **One trade can make a month.** Hexchaser's result is a single STRK run; its other trades were roughly flat. Ten
   days is far too short to call any of the three styles better than the others.
4. **A strategy that never triggers teaches nothing.** The Breakout bee sat flat for 3.5 days; a style needs to trade
   often enough to be judged within the test window.
5. **Rules in plain English only steer.** The built-in styles cannot be changed by the owner's text (e.g. Momentum's
   24-hour lock, long-only entries); a genuinely different strategy needed code (the `wanna` style).

## Restarting

`docker compose up -d` in the repo folder resumes all three bees with their saved positions and history (the engine is
built locally, see `docker-compose.override.yml`). Backups of the earlier designs live in the `bees-data` volume
(`/data/pre-redesign-20260930/`, `/data/pre-swap-bee2-*`).

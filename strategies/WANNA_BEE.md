# Wanna Bee: the contrarian (style: Contrarian Momentum)

**Owner's rules (2026-10-04):** Momentum + funding edge: long the strongest 7-day leaders with rising volume, short the
weakest laggards, and always prefer the side where funding is stretched against the crowd. Hard stop 6-8%, take half
at +6%, trail the rest. Exit if funding flips against the position. Rotate freely between leaders, no holding period,
no loyalty to a coin.

## Jev menu

    LONG_<coin>    x up to 4: top-20% 7-day leaders, volume z > 0, funding <= -0.002%/8h (shorts pay)
    SHORT_<coin>   x up to 4: bottom-20% 7-day laggards, volume z > 0, funding >= +0.002%/8h (longs pay)
    WAIT           while flat and something is on offer (Jev may decline every entry)
    HOLD           while holding; a menu coin becomes a switch only if clearly stronger (momentum z +0.5)
    CLOSE          only once the held coin failed the filters on 3 market refreshes in a row (the exits are code's)
    conviction: score ["meh","keen","eager","all-in"] (display only)

## Risk and forcing (code)

- Size: 1x equity. No adds. Never forced in while flat.
- Stop: clamp(4 + 2 x ATR(1h)%, 6, 8)% from entry (7% at a typical swing).
- Half off once the mark is +6% past entry; then the stop trails 3 x ATR(1h) behind the mark, never below break-even.
- Funding sign flips against the position (long: > 0, short: < 0): closed at once, whatever Jev says, even when benched.
- 6 trades a day, $3.00 fee budget, 5 min cooldown (`WANNA_*`).

## 4 Oct 2026 fix

The first menu had no WAIT and a plain CLOSE on every tick. With ZEC the only candidate, Jev was handed a lone
SHORT_ZEC (a forced pick), then flipped a ~50/50 HOLD/CLOSE coin every 10 s: six round trips in 30 minutes, $1.91 in
fees, trade cap gone by 10:28 UTC. WAIT now lets Jev decline, and CLOSE waits for the coin to stop qualifying.

## 5 Oct 2026 fix

Still 23 orders in a day: ENA's volume sat at the line, so "no longer qualifies" flickered and CLOSE was taken five
times in 20 minutes; then ZEC and TAO ranked almost equal and it switched between them every 5 minutes (the
cooldown). CLOSE now needs 3 failed refreshes in a row (about 3 minutes) and a switch needs a clearly stronger coin.
No holding period.

## Honest expectation

Most coins carry slightly positive funding, so this bee is short more often than long. Exits on a bare sign flip
are frequent on coins whose funding hovers near zero; the 0.002% entry edge keeps it out of those.

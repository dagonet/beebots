# Wanna Bee: the contrarian (style: Contrarian Momentum)

**Owner's rules (2026-10-04):** Momentum + funding edge: long the strongest 7-day leaders with rising volume, short the
weakest laggards, and always prefer the side where funding is stretched against the crowd. Hard stop 6-8%, take half
at +6%, trail the rest. Exit if funding flips against the position. Rotate freely between leaders, no holding period,
no loyalty to a coin.

## Jev menu

    LONG_<coin>    x up to 4: top-20% 7-day leaders, volume z > 0, funding <= -0.002%/8h (shorts pay)
    SHORT_<coin>   x up to 4: bottom-20% 7-day laggards, volume z > 0, funding >= +0.002%/8h (longs pay)
    HOLD / CLOSE   while holding; every other menu coin becomes a switch
    conviction: score ["meh","keen","eager","all-in"] (display only)

## Risk and forcing (code)

- Size: 1x equity. No adds. Never forced in while flat.
- Stop: clamp(4 + 2 x ATR(1h)%, 6, 8)% from entry (7% at a typical swing).
- Half off once the mark is +6% past entry; then the stop trails 3 x ATR(1h) behind the mark, never below break-even.
- Funding sign flips against the position (long: > 0, short: < 0): closed at once, whatever Jev says, even when benched.
- 6 trades a day, $3.00 fee budget, 5 min cooldown (`WANNA_*`).

## Honest expectation

Most coins carry slightly positive funding, so this bee is short more often than long. Exits on a bare sign flip
are frequent on coins whose funding hovers near zero; the 0.002% entry edge keeps it out of those.

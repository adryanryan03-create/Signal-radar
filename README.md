# Signal Radar — which pre-token protocol is worth the most at launch?

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adryanryan03-create/Signal-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adryanryan03-create/Signal-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Entry for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).

Signal Radar reads the competition's sealed DefiLlama snapshot (758 protocols, as of
2026-11-14) and ranks the protocols that do not have a token yet by what a fair launch
would plausibly be worth — not by raw TVL, but by TVL priced the way the market already
prices comparable live tokens, then adjusted for each protocol's own signals.

## The model (signal-radar-3)

```
implied value = TVL × anchor × momentum × longevity × breadth
```

- **Anchor ×0.1914** — measured from the snapshot itself: the median market-cap/TVL
  multiple of its live-token protocols, trimmed to (0, 10]. The market's own going rate,
  not a round number picked by hand.
- **Momentum** — the 7-day TVL change, clamped to −40%…+80% and weighted ×0.75, so one
  hot or cold week tilts a value without deciding it.
- **Longevity** — a log curve on days since listing (unknown age counts as 540 days):
  protocols that have held TVL for years are likelier to convert it into a durable token.
- **Breadth** — +4% per chain beyond the first, capped at five, for distribution that
  already exists.

Every multiplier is rounded to four decimals before use, and the dashboard recomputes
each value in the page from the same figures — the number on screen and the number in
`board.json` agree to the dollar.

## Scope: two zones, 213 rows

Above the snapshot's $50M floor the board ranks exactly the house watchlist (40/40
covered): up there, a pre-token protocol the house set aside was excluded for a reason
the snapshot's ten fields cannot show — a wrapped or bridged product of a protocol that
already has a token, like WBTC — so those are never ranked as launches. Below the floor
the net widens to every pre-token protocol that is not an exchange, a versioned pool, or
a named wrapped/staked product: 173 early finds on top of the 40 watchlist rows.

Each of the 213 rows carries a seven-step farm plan with a cost and a time on every
step, drawn from one of two skeletons chosen by category: **usage-based** for exchanges,
derivatives, bridges and payments (test cheap, then show up on separate days), and
**position-based** for lending, vaults, staking and yield (set up, deposit, deepen,
maintain, hold, claim, log).

## Dashboard

`dashboard/` is a fully static page — no network, no build step — with the ranked
board, a per-protocol detail view showing the full multiplier breakdown and farm plan,
and search / category / chain / watchlist-only filters plus sortable columns. The 24
live-token protocols above the floor are set aside in their own view at real market
caps, never mixed into the ranking.

## Reproduce

```
node main.ts --input <snapshot.json>
```

Node 22 standard library only. The run writes `board.json`, `dossier.json`, and the
dashboard data file; two consecutive runs are byte-identical.

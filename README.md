# u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/akhmadfitriyanramadhan23-wq/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/akhmadfitriyanramadhan23-wq/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A small trading bot that reads hourly bars and decides when to hold SOL, when to sit in USDC, and how much to trade — built to beat buy-and-hold on Solana.

## Strategy

Two long-only legs, deterministic, no network, no environment secrets:

- **Trend leg:** EMA(8) crosses above EMA(21) with close above EMA(8) and RSI(14) < 60 — buys 1/7 of equity per signal (25% weight cap).
- **Bounce leg:** RSI(14) ≤ 28 with close up from the previous bar — buys 10% of equity.
- **Exits:** trend leg exits when the fast EMA falls back below the slow one; trailing stop 4% from peak, hard stop −8% from cost, RSI ≥ 78. Bounce leg exits at RSI ≥ 55, take-profit +6%, stop −3%. Slippage capped at 300 bps, sells first.

## Dev results (grade-local, `--driver process`, 136 hourly bars)

- Net PnL **+151.40 USDC** (+1.51%; 90% interval +5.03 to +299.84 — entirely positive; still +107.38 at 2x fees)
- Buy-and-hold baseline on the same window: **−869.34 USDC** — margin **+1,020.74 USDC**
- **38 trades** (minimum 8), win rate **78.9%**, max drawdown **1.21%** (limit 25%), 0 rejected, exposure 17.0%
- `result_sha256` 4ea5c5618f6af133e0d4ebc4353a783e215f496b7bfca4c4ad7538ab496daccd; re-grade reproduced byte for byte.

## Run it

```sh
node main.ts
```

Grade it on the dev data as the server will (from the unpacked kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=yd8r37m9&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>

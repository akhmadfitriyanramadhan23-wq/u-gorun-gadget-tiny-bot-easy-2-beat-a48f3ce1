// Entry: Tiny Bot, Easy $2 — beat buy-and-hold on Solana hourly bars.
// Wires the bars-replay shim (vendor/makefun-bars.ts) to the strategy in
// strategy.ts: an EMA(8)/EMA(21) trend leg plus an RSI(14) oversold
// bounce leg, long only, with trailing/hard stops and an overbought exit.
// Deterministic: no clock, no randomness, no environment, no network.

import { runBars } from './vendor/makefun-bars.ts';
import { createStrategy } from './strategy.ts';

const strategy = createStrategy();

await runBars({
  onBatch(state, batch) {
    return strategy.onBatch(state, batch);
  },
});

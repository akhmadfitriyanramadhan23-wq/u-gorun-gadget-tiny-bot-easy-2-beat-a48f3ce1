// Strategy: two-leg long-only bot for hourly Solana bars.
//
//   Leg 1 — trend: EMA(8) crosses above EMA(21), the close sits above the
//   fast EMA, and RSI(14) is not hot (< 60). Buys one equal slice
//   (equity / universe size, capped at the 25% weight cap).
//   Leg 2 — bounce: RSI(14) <= 28 and the close ticked up from the prior
//   bar (an oversold hourly bar turning). Buys a 10% slice of equity:
//   mean reversion pays in choppy tape, so it stays smaller than a trend
//   slice.
//
//   Exits (either leg, whole position): the fast EMA falls back under the
//   slow EMA (trend leg only — a bounce entry is made while the EMA trend
//   is down), a 4% trailing stop off the position's peak value, an 8%
//   hard stop under cost, or RSI(14) >= 78 (overbought).
//   Bounce positions additionally exit on RSI(14) >= 55 (recovered),
//   +6% take-profit, or -3% stop.
//
//   Everything is deterministic: float64 EMAs seeded as the mean of their
//   first span of closes, plain average-gain/loss RSI, no clock, no
//   randomness, no environment, no network. Orders decided on bar k fill
//   at bar k+1's open, so a sell refused by the market is re-sent on the
//   next bar while its (persistent) exit reason still holds.

import type { Bar, BarsState, BuyInput, SellInput } from './vendor/makefun-bars.ts';
import { BPS } from './vendor/makefun-bars.ts';

export const FAST_SPAN = 8;
export const SLOW_SPAN = 21;
export const RSI_PERIOD = 14;
export const RSI_ENTRY_MAX = 60;
export const RSI_EXIT = 78;
export const TRAIL_BPS = 400;
export const STOP_BPS = 800;
export const BOUNCE_RSI = 28;
export const BOUNCE_EXIT_RSI = 55;
export const BOUNCE_TP_BPS = 600;
export const BOUNCE_STOP_BPS = 300;
export const BOUNCE_WEIGHT_BPS = 1000;
export const MAX_SLIPPAGE_BPS = 300;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the previous bar, once both EMAs are set. */
  gap: number | null;
  /** fast - slow after this bar. */
  now: number | null;
  /** Last 15 closes, for RSI(14). */
  closes: number[];
  /** Previous bar's close, for the bounce leg's tick-up test. */
  prevClose: number | null;
}

interface Held {
  kind: 'trend' | 'bounce';
  /** Peak position value (quote units) seen at a close since entry. */
  peak: bigint;
}

function newEma(span: number): Ema {
  return { span, warm: [], value: null };
}

function emaStep(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

/** Plain RSI: 100 - 100 / (1 + avgGain / avgLoss) over the last 14 closes. */
function rsi(closes: number[]): number | null {
  if (closes.length < RSI_PERIOD + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - RSI_PERIOD; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function createStrategy() {
  const series = new Map<string, Series>();
  const held = new Map<string, Held>();

  function push(bar: Bar): Series {
    let s = series.get(bar.symbol);
    if (s === undefined) {
      s = { fast: newEma(FAST_SPAN), slow: newEma(SLOW_SPAN), gap: null, now: null, closes: [], prevClose: null };
      series.set(bar.symbol, s);
    }
    const c = Number(bar.c);
    s.prevClose = s.closes.length > 0 ? s.closes[s.closes.length - 1]! : null;
    s.closes.push(c);
    if (s.closes.length > RSI_PERIOD + 1) s.closes.shift();
    emaStep(s.fast, c);
    emaStep(s.slow, c);
    s.gap = s.now;
    s.now = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
    return s;
  }

  function exits(state: BarsState, symbol: string, h: Held): boolean {
    const s = series.get(symbol)!;
    const pos = state.positions.get(symbol)!;
    const value = state.value(symbol, pos.qty);
    if (value > h.peak) h.peak = value;
    const bps = BigInt(BPS);
    // Trend gone: fast EMA back under the slow one (persistent, not a one-bar
    // event). Applies to the trend leg only: a bounce entry is made exactly
    // while the EMA trend is down, so this test must not kill it a bar later.
    if (h.kind === 'trend' && s.now !== null && s.now < 0) return true;
    // Trailing stop: value <= 96% of the peak value.
    if (value * bps <= h.peak * (bps - BigInt(TRAIL_BPS))) return true;
    // Hard stop: value <= 92% of cost.
    if (value * bps <= pos.cost * (bps - BigInt(STOP_BPS))) return true;
    // Overbought.
    const r = rsi(s.closes);
    if (r !== null && r >= RSI_EXIT) return true;
    if (h.kind === 'bounce') {
      // Bounce leg's own exits: recovered, take-profit, or stop.
      if (r !== null && r >= BOUNCE_EXIT_RSI) return true;
      if (value * bps >= pos.cost * (bps + BigInt(BOUNCE_TP_BPS))) return true;
      if (value * bps <= pos.cost * (bps - BigInt(BOUNCE_STOP_BPS))) return true;
    }
    return false;
  }

  function onBatch(state: BarsState, batch: { bars: Bar[] }): (BuyInput | SellInput)[] {
    const fresh = new Set<string>();
    const crossUp = new Set<string>();
    const bounce = new Set<string>();
    for (const bar of batch.bars) {
      const s = push(bar);
      fresh.add(bar.symbol);
      if (s.gap === null || s.now === null || s.fast.value === null) continue;
      const r = rsi(s.closes);
      const c = Number(bar.c);
      if (!state.positions.has(bar.symbol)) {
        if (s.now > 0 && s.gap <= 0 && c > s.fast.value && (r === null || r < RSI_ENTRY_MAX)) crossUp.add(bar.symbol);
        else if (r !== null && r <= BOUNCE_RSI && s.prevClose !== null && c > s.prevClose) bounce.add(bar.symbol);
      }
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const pos = state.positions.get(symbol);
      if (pos === undefined) continue;
      let h = held.get(symbol);
      if (h === undefined) {
        h = { kind: 'trend', peak: state.value(symbol, pos.qty) };
        held.set(symbol, h);
      }
      if (exits(state, symbol, h)) {
        sells.push({ side: 'sell', symbol, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        held.delete(symbol);
      }
    }

    const orders: (BuyInput | SellInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const trendSlice = state.equity / BigInt(slots);
    const weightCap = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const bounceSlice = (BigInt(BOUNCE_WEIGHT_BPS) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    const buy = (symbol: string, slice: bigint, kind: 'trend' | 'bounce'): void => {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) return;
      let amount = slice < weightCap ? slice : weightCap;
      if (cash < amount) amount = cash;
      if (amount === 0n || amount < BigInt(fees.min_notional_quote_units)) return;
      orders.push({ side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS });
      held.set(symbol, { kind, peak: 0n });
      cash -= amount;
      room--;
    };
    for (const symbol of state.hello.symbols.map((s) => s.symbol)) {
      if (crossUp.has(symbol)) buy(symbol, trendSlice, 'trend');
    }
    for (const symbol of state.hello.symbols.map((s) => s.symbol)) {
      if (bounce.has(symbol)) buy(symbol, bounceSlice, 'bounce');
    }
    return orders;
  }

  return { onBatch };
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Charge/discharge strategy algorithm (pure functions, no I/O), following
// the charge/discharge strategy rules.
//
// Windows slide over the day's price slots with the price granularity G as the step;
// durations are counted in slots (round(minutes / 60 / G)). Per day:
//   1. Discharge: one window (n slots, highest price sum) or two windows
//      (x + (n - x) slots, at least 2 hours apart, highest total sum).
//      Tail reservation (one discharge only): the window may not cover the last
//      P hours (P = M / 60, i.e. m slots). It only blocks the discharge; the charge is
//      chosen by price like any other (agreed rule).
//   2. Tail special handling (two discharges, on the chosen pair): if the last discharge
//      includes 23:00-24:00, a gap of 4 hours or more moves the last discharge 2 hours
//      earlier, a smaller gap moves both 2 hours earlier; the last 2 hours are charging
//      (on top of M).
//   3. Charge (one or two discharges): one window (m slots, lowest sum) or two windows
//      (x + (m - x) slots) with exactly one discharge between them and more than
//      2 hours apart; the lower charge sum wins (one window on a tie). After the tail
//      handling the last 2 hours are charged on top (not counted in M) and count as one of
//      the two charges: M is one window before them with exactly one discharge between.
//      If no such window exists, the two-discharge option is infeasible.
//   4. Composition (no score): the discharge option with the larger discharge price sum
//      wins (one discharge on a tie) and takes its best charge; charge and discharge are
//      not compared with each other.
//   3.5 Last stage: going from the end of the day backwards, if the first stage that is
//      not FLAT is a discharge, the last slot of the day is set to charging.
// One price tier: no charging or discharging, the whole day is FLAT. Two price tiers: no FLAT.
// Stage labels follow the Deployment 错峰调整 template:
//   charging period -> LOW, discharging period -> PEAK, otherwise -> FLAT.

export type Stage = 'LOW' | 'FLAT' | 'PEAK';

export interface StrategySegment {
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  stage: Stage;
}

/** Slot window [start, end), indices into the day's price slots. */
interface Window {
  start: number;
  end: number;
}

export function stageFor(kind: 'charge' | 'discharge' | 'flat'): Stage {
  if (kind === 'charge') return 'LOW';
  if (kind === 'discharge') return 'PEAK';
  return 'FLAT';
}

// Sums come from prefix sums, so equal windows can differ in the last bits; a window
// only replaces the current best when it is better by more than EPS (first one wins a tie).
const EPS = 1e-9;

const overlaps = (a: Window, b: Window): boolean => a.start < b.end && b.start < a.end;

function slotTime(slot: number, G: number): string {
  const minutes = Math.round(slot * G * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function prefixSums(prices: number[]): (w: Window) => number {
  const pre = [0];
  for (const p of prices) pre.push(pre[pre.length - 1] + p);
  return (w) => pre[w.end] - pre[w.start];
}

// Step 1, one discharge: the n-slot window with the highest price sum, ending by slot `end`.
function selectDischarge1(sum: (w: Window) => number, end: number, n: number): Window[] | null {
  let best: Window | null = null;
  for (let s = 0; s + n <= end; s++) {
    const w = { start: s, end: s + n };
    if (!best || sum(w) > sum(best) + EPS) best = w;
  }
  return best ? [best] : null;
}

// Step 1, two discharges: x + (n - x) slots, at least gapSlots apart, highest total sum.
// The tail special handling is applied to the chosen pair afterwards:
// applied to every candidate it could never change the result, because a shifted pair
// is itself a candidate with the same sum.
function selectDischarge2(sum: (w: Window) => number, S: number, n: number, gapSlots: number): Window[] | null {
  let best: Window[] | null = null;
  let bestSum = -Infinity;
  for (let x = 1; x < n; x++) {
    for (let s1 = 0; s1 + x <= S; s1++) {
      const w1 = { start: s1, end: s1 + x };
      for (let s2 = w1.end + gapSlots; s2 + (n - x) <= S; s2++) {
        const w2 = { start: s2, end: s2 + n - x };
        const total = sum(w1) + sum(w2);
        if (total > bestSum + EPS) {
          bestSum = total;
          best = [w1, w2];
        }
      }
    }
  }
  return best;
}

// Step 2, tail special handling for two discharges whose last window includes the
// last hour: gap >= 4 h moves the last discharge 2 h earlier, a smaller gap moves both;
// the last 2 hours become an extra charge window (not counted toward M). Returns null when the first discharge has no
// room to move (it would start before 00:00), so this two-discharge option is dropped.
function applyTailHandling(
  windows: Window[],
  S: number,
  shiftSlots: number,
  gapThresholdSlots: number
): { windows: Window[]; tailCharge?: Window } | null {
  const [w1, w2] = windows;
  if (w2.end !== S) return { windows };
  const moved2 = { start: w2.start - shiftSlots, end: w2.end - shiftSlots };
  if (w2.start - w1.end >= gapThresholdSlots) {
    return { windows: [w1, moved2], tailCharge: { start: S - shiftSlots, end: S } };
  }
  if (w1.start < shiftSlots) return null;
  const moved1 = { start: w1.start - shiftSlots, end: w1.end - shiftSlots };
  return { windows: [moved1, moved2], tailCharge: { start: S - shiftSlots, end: S } };
}

interface ChargeChoice {
  windows: Window[];
  sum: number;
}

// Exactly one discharge window lies between two charge windows (a before b).
const oneDischargeBetween = (a: Window, b: Window, discharges: Window[]): boolean =>
  discharges.filter((d) => d.start >= a.end && d.end <= b.start).length === 1;

// Step 3, one charge: the m-slot window with the lowest sum outside the occupied windows.
function selectCharge1(sum: (w: Window) => number, S: number, m: number, occupied: Window[]): ChargeChoice | null {
  let best: ChargeChoice | null = null;
  for (let s = 0; s + m <= S; s++) {
    const w = { start: s, end: s + m };
    if (occupied.some((o) => overlaps(w, o))) continue;
    if (!best || sum(w) < best.sum - EPS) best = { windows: [w], sum: sum(w) };
  }
  return best;
}

// Step 3, two charges: x + (m - x) slots outside the occupied windows, exactly one
// discharge window between them and more than 2 hours (minGapSlots) apart; lowest total sum.
function selectCharge2(
  sum: (w: Window) => number,
  S: number,
  m: number,
  occupied: Window[],
  discharges: Window[],
  minGapSlots: number
): ChargeChoice | null {
  let best: ChargeChoice | null = null;
  for (let x = 1; x < m; x++) {
    for (let s1 = 0; s1 + x <= S; s1++) {
      const w1 = { start: s1, end: s1 + x };
      if (occupied.some((o) => overlaps(w1, o))) continue;
      for (let s2 = w1.end + minGapSlots; s2 + (m - x) <= S; s2++) {
        const w2 = { start: s2, end: s2 + m - x };
        if (occupied.some((o) => overlaps(w2, o))) continue;
        // 两次充电之间必须有一次放电: exactly one discharge window lies between the two charges.
        if (!oneDischargeBetween(w1, w2, discharges)) continue;
        const total = sum(w1) + sum(w2);
        if (!best || total < best.sum - EPS) best = { windows: [w1, w2], sum: total };
      }
    }
  }
  return best;
}

// Step 3 after the tail handling: the last 2 hours are one charge (not counted in M),
// so M is a single window before it with exactly one discharge between them and more
// than 2 hours (minGapSlots) apart. Null when no such window exists.
function selectChargeBeforeTail(
  sum: (w: Window) => number,
  m: number,
  tail: Window,
  discharges: Window[],
  minGapSlots: number
): ChargeChoice | null {
  let best: ChargeChoice | null = null;
  for (let s = 0; s + m + minGapSlots <= tail.start; s++) {
    const w = { start: s, end: s + m };
    if (discharges.some((d) => overlaps(w, d))) continue;
    if (!oneDischargeBetween(w, tail, discharges)) continue;
    if (!best || sum(w) < best.sum - EPS) best = { windows: [w], sum: sum(w) };
  }
  return best;
}

export interface GenerateResult {
  segments: StrategySegment[];
  /** 'A' = one discharge, 'B' = two discharges, 'none' = not executed (whole day FLAT). */
  plan: 'A' | 'B' | 'none';
  chargeCount?: number;
  reason?: string;
  /** True when the two-discharge tail handling moved the discharges and charges the last 2 hours. */
  tailShifted?: boolean;
  /** True when the last non-FLAT stage was a discharge and the last slot of the day was set to charging. */
  lastSlotCharge?: boolean;
}

// One stage per slot: discharge -> PEAK, charge -> LOW, otherwise FLAT; on a
// two-tier day a slot outside the windows takes the label of its price tier.
function slotStages(S: number, discharge: Window[], charge: Window[], prices: number[], twoTierHigh?: number): Stage[] {
  const inAny = (ws: Window[], i: number) => ws.some((w) => i >= w.start && i < w.end);
  return Array.from({ length: S }, (_, i) => {
    if (inAny(discharge, i)) return stageFor('discharge');
    if (inAny(charge, i)) return stageFor('charge');
    if (twoTierHigh === undefined) return stageFor('flat');
    return prices[i] === twoTierHigh ? stageFor('discharge') : stageFor('charge');
  });
}

// Full-day segments (FLAT included), merged where the stage is equal.
function toSegments(stages: Stage[], G: number): StrategySegment[] {
  const segments: StrategySegment[] = [];
  stages.forEach((stage, i) => {
    const last = segments[segments.length - 1];
    if (last && last.stage === stage) last.endTime = slotTime(i + 1, G);
    else segments.push({ startTime: slotTime(i, G), endTime: slotTime(i + 1, G), stage });
  });
  return segments;
}

// The whole day as one FLAT segment (no charging or discharging).
const flatDay = (S: number, G: number): StrategySegment[] => [
  { startTime: slotTime(0, G), endTime: slotTime(S, G), stage: stageFor('flat') },
];

/**
 * Generate the strategy for one day.
 * @param prices the day's slot prices in time order (24 / G values)
 * @param n discharge duration in slots
 * @param m charge duration in slots
 * @param G price granularity in hours (0.25, 0.5 or 1); 1 = hourly prices
 */
export function generateDailyStrategy(prices: number[], n: number, m: number, G = 1): GenerateResult {
  const S = prices.length;
  const distinct = new Set(prices).size;
  if (distinct <= 1) {
    return { segments: flatDay(S, G), plan: 'none', reason: 'peak-shaving not executed' };
  }
  const sum = prefixSums(prices);
  const dischargeGap = Math.ceil(2 / G - 1e-9);        // discharges >= 2 h apart
  const chargeGap = Math.floor(2 / G + 1e-9) + 1;      // charges > 2 h apart
  const tailShift = Math.round(2 / G);                 // tail handling: 2 hours
  const tailGapThreshold = Math.round(4 / G);          // tail handling: gap of 4 hours

  // Step 1: discharge options. A = one discharge that ends before the last P hours;
  // B = two discharges after the tail special handling.
  const one = selectDischarge1(sum, S - m, n);
  const two = n >= 2 ? selectDischarge2(sum, S, n, dischargeGap) : null;
  const handled = two ? applyTailHandling(two, S, tailShift, tailGapThreshold) : null;
  const dischargeSum = (ws: Window[]) => ws.reduce((a, w) => a + sum(w), 0);

  // Step 2: the charge for an option: the cheaper of one or two charge windows. For B after
  // the tail handling, the last 2 hours are charged on top (not counted in M).
  type Plan = { plan: 'A' | 'B'; discharge: Window[]; charges: Window[]; chargeCount: number; tailShifted?: boolean };
  const planA = (): Plan | null => {
    if (!one) return null;
    // Scenario 1: the cheaper of one charge window or two (with the discharge
    // between them, > 2 h apart). The last P hours only block the discharge.
    const c1 = selectCharge1(sum, S, m, one);
    const c2 = m >= 2 ? selectCharge2(sum, S, m, one, one, chargeGap) : null;
    const charge = c1 && (!c2 || c1.sum <= c2.sum + EPS) ? c1 : c2;
    return charge ? { plan: 'A', discharge: one, charges: charge.windows, chargeCount: charge.windows.length } : null;
  };
  const planB = (): Plan | null => {
    if (!handled) return null;
    const discharge = handled.windows;
    const tail = handled.tailCharge;
    let charge: ChargeChoice | null;
    if (tail) {
      // The tail's 2 hours are a charge too, so the rules for two charges apply to it:
      // M is one window before it with exactly one discharge between them, > 2 h apart.
      charge = selectChargeBeforeTail(sum, m, tail, discharge, chargeGap);
    } else {
      const c1 = selectCharge1(sum, S, m, discharge);
      const c2 = m >= 2 ? selectCharge2(sum, S, m, discharge, discharge, chargeGap) : null;
      charge = c1 && (!c2 || c1.sum <= c2.sum + EPS) ? c1 : c2;
    }
    if (!charge) return null;
    return {
      plan: 'B',
      discharge,
      charges: tail ? [...charge.windows, tail] : charge.windows,
      chargeCount: charge.windows.length + (tail ? 1 : 0),
      ...(tail ? { tailShifted: true } : {}),
    };
  };

  // Step 3: composition. The discharge option with the larger discharge price sum wins
  // (one discharge on a tie); its best charge completes the plan. Charge and discharge
  // are not compared with each other. If that option has no feasible charge, the other is used.
  const preferA = one !== null && (!handled || dischargeSum(one) >= dischargeSum(handled.windows) - EPS);
  const chosen = preferA ? (planA() ?? planB()) : (planB() ?? planA());
  if (!chosen) {
    return { segments: flatDay(S, G), plan: 'none', reason: 'no feasible charge/discharge windows' };
  }

  // Two-tier rule (Deployment template): exactly two distinct prices -> no FLAT entries;
  // slots outside the windows take LOW for the lower price, PEAK for the higher.
  const twoTierHigh = distinct === 2 ? Math.max(...prices) : undefined;
  const stages = slotStages(S, chosen.discharge, chosen.charges, prices, twoTierHigh);

  // Step 3.5: going from the end of the day backwards, the first stage that is not FLAT
  // must not be a discharge; if it is, the last slot of the day is set to charging.
  let i = S - 1;
  while (i >= 0 && stages[i] === stageFor('flat')) i--;
  const lastSlotCharge = i >= 0 && stages[i] === stageFor('discharge');
  if (lastSlotCharge) stages[S - 1] = stageFor('charge');

  return {
    segments: toSegments(stages, G),
    plan: chosen.plan,
    chargeCount: chosen.chargeCount,
    ...(chosen.tailShifted ? { tailShifted: true } : {}),
    ...(lastSlotCharge ? { lastSlotCharge: true } : {}),
  };
}

/**
 * One segment per price slot (agreed rule: the strategy has as many records
 * as the price list, e.g. 24 for hourly prices). Splits merged segments into G-hour slots.
 */
export function expandToSlots(segments: StrategySegment[], G: number): StrategySegment[] {
  const step = Math.round(G * 60);
  const out: StrategySegment[] = [];
  for (const seg of segments) {
    for (let m = toMinutes(seg.startTime); m < toMinutes(seg.endTime); m += step) {
      out.push({ startTime: minutesToTime(m), endTime: minutesToTime(m + step), stage: seg.stage });
    }
  }
  return out;
}

const minutesToTime = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const toMinutes = (t: string): number => {
  const [h, m] = t.trim().split(':').map(Number);
  return h * 60 + m;
};

// Hourly prices from the day's price slots (time-weighted average per hour).
// The strategy itself works on the slots; this is kept for hourly views.
export function toHourlyPrices(slots: Array<{ timeSlot: string; price: number }>): number[] {
  const weighted = Array.from({ length: 24 }, () => ({ sum: 0, minutes: 0 }));
  for (const s of slots) {
    const [start, end] = s.timeSlot.split('-').map(toMinutes);
    for (let h = Math.floor(start / 60); h < 24 && h * 60 < end; h++) {
      const overlap = Math.min(end, (h + 1) * 60) - Math.max(start, h * 60);
      if (overlap > 0) {
        weighted[h].sum += s.price * overlap;
        weighted[h].minutes += overlap;
      }
    }
  }
  return weighted.map(({ sum, minutes }, h) => {
    if (minutes === 0) throw new Error(`no price for ${slotTime(h, 1)}-${slotTime(h + 1, 1)}`);
    return Math.round((sum / minutes) * 1e6) / 1e6;
  });
}

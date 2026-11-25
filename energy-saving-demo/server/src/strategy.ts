// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Charge/discharge strategy generation (design doc section 2.7).
 *
 * Works on one day of prices (one number per granularity slot) and returns a stage per slot.
 */

import { expandToSlots, generateDailyStrategy, type Stage } from './strategy-engine.js'

export type { Stage }
export type Window = [start: number, end: number]
export interface StrategyRow {
  date: string
  startTime: string
  endTime: string
  stage: Stage
}

/** Round half to even, so slot counts match the reference algorithm for values like 2.5. */
export function roundEven(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}

/**
 * One day of stages, one per price slot. The plan itself comes from strategy-engine.ts, the team's algorithm of the
 * charge/discharge strategy design (the colleague's energy-saving-uc code, copied unchanged). Durations are counted in
 * whole price slots; a day that cannot hold the charge and the discharge stays FLAT.
 */
export function planDay(prices: number[], chargeMin: number, dischargeMin: number, granularityH: number): Stage[] {
  const n = Math.max(1, Math.round(dischargeMin / 60 / granularityH))
  const m = Math.max(1, Math.round(chargeMin / 60 / granularityH))
  if (n + m > prices.length) return Array<Stage>(prices.length).fill('FLAT')
  const day = generateDailyStrategy(prices, n, m, granularityH)
  return expandToSlots(day.segments, granularityH).map((x) => x.stage)
}

/** Join rows of the same day and stage that follow each other (end = next start) into one period. */
export function mergeRows<T extends { date: string; startTime: string; endTime: string; stage: string }>(rows: T[]): T[] {
  const out: T[] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last.date === r.date && last.stage === r.stage && last.endTime === r.startTime) out[out.length - 1] = { ...last, endTime: r.endTime }
    else out.push({ ...r })
  }
  return out
}

export const hhmm = (slot: number, g: number) => {
  const m = roundEven(slot * g * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function merge(date: string, stages: Stage[], g: number): StrategyRow[] {
  const out: StrategyRow[] = []
  let start = 0
  for (let i = 1; i <= stages.length; i++) {
    if (i === stages.length || stages[i] !== stages[start]) {
      out.push({ date, startTime: hhmm(start, g), endTime: i === stages.length ? '24:00' : hhmm(i, g), stage: stages[start] })
      start = i
    }
  }
  return out
}

/** rows: [date, slotIndex, price] -> merged strategy list. */
export function generate(rows: [string, number, number][], chargeMin: number, dischargeMin: number, granularityH: number): StrategyRow[] {
  const days = new Map<string, Map<number, number>>()
  for (const [d, i, p] of rows) {
    if (!days.has(d)) days.set(d, new Map())
    days.get(d)!.set(i, p)
  }
  const result: StrategyRow[] = []
  for (const d of [...days.keys()].sort()) {
    const slots = days.get(d)!
    const prices = [...slots.keys()].sort((a, b) => a - b).map((i) => slots.get(i)!)
    result.push(...merge(d, planDay(prices, chargeMin, dischargeMin, granularityH), granularityH))
  }
  return result
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { Db } from './db.js'
import { resolveQueryDate } from './query-date.js'
import { mergeRows } from './strategy.js'

/**
 * The price and the charge/discharge plan of one day, read straight from the database. The web API
 * (/api/energy-saving/query, /day-query, the dialog) and the local query tool (./start.sh query, bin/ctl.mjs) both use this
 * code, so the rules live in one place: the newest batch that holds the day, FLAT periods left out, the strategy app's
 * one-row-per-slot plan merged into periods.
 */

export interface PriceRow {
  date: string
  timeSlot: string
  price: number
}
export interface PlanRow {
  date: string
  startTime: string
  endTime: string
  stage: string
}
export interface DayResult {
  day: string
  batchId: number
  prices: PriceRow[]
  plan: PlanRow[]
}
export interface DaySummary {
  slots: number
  tiers: number
  min: { price: number; timeSlots: string[] }
  max: { price: number; timeSlots: string[] }
  average: number
}

/** Prices and plan of one day (YYYY-MM-DD). */
export function queryDay(db: Db, day: string): DayResult {
  const newest = (table: string, dateColumn: string) =>
    (db.prepare(`SELECT MAX(batch_id) AS b FROM ${table} WHERE ${dateColumn}=?`).get(day) as { b: number | null }).b ?? 0
  const pb = newest('price_data', 'price_date')
  const sb = newest('charge_discharge_strategy', 'strategy_date')
  const prices = (
    db.prepare('SELECT price_date AS date, time_slot, price_value FROM price_data WHERE batch_id=? AND price_date=? ORDER BY time_slot').all(pb, day) as {
      date: string
      time_slot: string
      price_value: number
    }[]
  ).map((x) => ({ date: x.date, timeSlot: x.time_slot, price: x.price_value }))
  // The strategy app stores one row per price slot, the dashboard one row per period: both are shown as periods.
  const plan = mergeRows(
    (
      db
        .prepare("SELECT strategy_date AS date, start_time, end_time, stage FROM charge_discharge_strategy WHERE batch_id=? AND strategy_date=? AND stage<>'FLAT' ORDER BY id")
        .all(sb, day) as { date: string; start_time: string; end_time: string; stage: string }[]
    ).map((x) => ({ date: x.date, startTime: x.start_time, endTime: x.end_time, stage: x.stage })),
  )
  return { day, batchId: Math.max(pb, sb), prices, plan }
}

/** Cheapest and dearest price with their slots, the number of price levels and the average; null for a day without prices. */
export function summarize(prices: PriceRow[]): DaySummary | null {
  const values = prices.map((p) => p.price)
  if (!values.length) return null
  const at = (v: number) => prices.filter((p) => p.price === v).map((p) => p.timeSlot)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return {
    slots: values.length,
    tiers: new Set(values).size,
    min: { price: min, timeSlots: at(min) },
    max: { price: max, timeSlots: at(max) },
    average: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1e4) / 1e4,
  }
}

/** The days that have prices, oldest first. */
export function availableDates(db: Db): string[] {
  return (db.prepare('SELECT DISTINCT price_date AS d FROM price_data ORDER BY price_date').all() as { d: string }[]).map((r) => r.d)
}

/**
 * One day given as a word or a date (today, yesterday, day before yesterday, 3 days ago, 昨天, 2026-10-24 ...; see
 * query-date.ts), resolved against `now`: prices, plan, summary and, for a day without prices, the days that have them.
 * Throws QueryDateError for a day that cannot be read.
 */
export function dayQuery(db: Db, input: string | undefined, now = new Date()) {
  const result = queryDay(db, resolveQueryDate(input, now))
  const summary = summarize(result.prices)
  return { ...result, input: input ?? '', summary, ...(summary ? {} : { availableDates: availableDates(db) }) }
}

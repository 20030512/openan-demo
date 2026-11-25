// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Manageable test data for UC2. A dataset is a named scenario: price days plus the charge/discharge parameters the
 * strategy needs. "Apply" turns it into the latest price batch, which the dashboard dialog then queries.
 */
import type { Db } from './db.js'
import { SAMPLE_CHARGE_MIN, SAMPLE_DATASETS, SAMPLE_DISCHARGE_MIN } from './sample-datasets.js'
import { hhmm, merge, planDay, type Stage, type StrategyRow } from './strategy.js'

export const PROFILES = ['doc-example', 'flat', 'two-levels', 'single-peak', 'double-peak', 'last-hour-peak', 'random'] as const
/** The profiles a new dataset can be generated from; 'sample' only marks the built-in sample files. */
export type Profile = (typeof PROFILES)[number] | 'sample'

export const PROFILE_INFO: Record<Profile, string> = {
  'doc-example': 'The 24 hourly prices from the design doc worked example',
  flat: 'One price all day: no strategy should be produced',
  'two-levels': 'Cheap morning, expensive afternoon: LOW and PEAK only, never FLAT',
  'single-peak': 'One smooth price peak around 13:00',
  'double-peak': 'Morning and evening peaks: exercises the two-discharge plan',
  'last-hour-peak': 'Price highest at the end of the day: exercises the last-hour exception',
  random: 'Seeded random prices between 0.20 and 1.00',
  sample: 'A price sample file of the team (sample/test-prices)',
}

export const GRANULARITIES = [0.25, 0.5, 1]

const BASE = [0.3, 0.3, 0.3, 0.3, 0.5, 0.5, 0.8, 0.8, 0.9, 0.9, 0.9, 0.9, 0.7, 0.7, 0.6, 0.6, 0.8, 0.8, 1.0, 1.0, 0.9, 0.9, 0.5, 0.4]

const r2 = (x: number) => Math.round(x * 100) / 100
const bump = (h: number, centre: number, width: number) => Math.exp(-((h - centre) ** 2) / (2 * width ** 2))

/** Small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function priceAt(profile: Profile, h: number): number {
  switch (profile) {
    case 'doc-example': return BASE[Math.min(23, Math.floor(h))]
    case 'flat': return 0.5
    case 'two-levels': return h < 12 ? 0.2 : 0.9
    case 'single-peak': return 0.3 + 0.7 * bump(h, 13, 2.5)
    case 'double-peak': return 0.3 + 0.55 * bump(h, 9, 1.8) + 0.65 * bump(h, 19, 2)
    case 'last-hour-peak': return h >= 22 ? 1.0 : 0.3 + 0.2 * Math.abs(Math.sin(h / 4))
    default: return 0.5
  }
}

/** Generate `days` days of prices; day k is shifted by 0.02*k so multi-day sets differ but keep their shape. */
export function generateDays(profile: Profile, days: number, granularity: number, seed: number): number[][] {
  const slots = Math.round(24 / granularity)
  const rand = rng(seed)
  return Array.from({ length: days }, (_, k) =>
    Array.from({ length: slots }, (_, i) => {
      if (profile === 'random') return r2(0.2 + rand() * 0.8)
      const h = (i + 0.5) * granularity
      return r2(profile === 'flat' ? 0.5 : priceAt(profile, h) + 0.02 * k)
    }),
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Dates for a dataset: baseDate (default: server today) + startOffset + day index. */
export function dayDates(startOffset: number, n: number, baseDate?: string): string[] {
  const base = baseDate ? new Date(`${baseDate}T12:00:00`) : new Date()
  base.setHours(12, 0, 0, 0)
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(base)
    d.setDate(d.getDate() + startOffset + k)
    return isoDate(d)
  })
}

export const slotLabel = (i: number, g: number) => `${hhmm(i, g)}-${hhmm(i + 1, g)}`

export interface Dataset {
  id: number
  name: string
  description: string
  profile: Profile
  chargeMin: number
  dischargeMin: number
  granularity: number
  startOffset: number
  builtIn: boolean
  /** Region the user named when making the dataset; it is a region tasks can use. Empty when none. */
  region: string
  updatedAt: string
  days: number[][]
}

interface Row {
  id: number
  name: string
  description: string
  profile: Profile
  charge_min: number
  discharge_min: number
  granularity: number
  start_offset: number
  built_in: number
  region: string
  updated_at: string
  days_json: string
}

const toDataset = (r: Row): Dataset => ({
  id: r.id,
  name: r.name,
  description: r.description,
  profile: r.profile,
  chargeMin: r.charge_min,
  dischargeMin: r.discharge_min,
  granularity: r.granularity,
  startOffset: r.start_offset,
  builtIn: r.built_in === 1,
  region: r.region,
  updatedAt: r.updated_at,
  days: JSON.parse(r.days_json) as number[][],
})

export const listDatasets = (db: Db): Dataset[] =>
  (db.prepare('SELECT * FROM test_dataset ORDER BY id').all() as unknown as Row[]).map(toDataset)

export const getDataset = (db: Db, id: number): Dataset | null => {
  const r = db.prepare('SELECT * FROM test_dataset WHERE id=?').get(id) as unknown as Row | undefined
  return r ? toDataset(r) : null
}

export type NewDataset = Omit<Dataset, 'id' | 'updatedAt' | 'days'> & { days: number[][] }

export function insertDataset(db: Db, d: NewDataset): number {
  const r = db
    .prepare(
      `INSERT INTO test_dataset(name,description,profile,charge_min,discharge_min,granularity,start_offset,built_in,region,updated_at,days_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(d.name, d.description, d.profile, d.chargeMin, d.dischargeMin, d.granularity, d.startOffset, d.builtIn ? 1 : 0, d.region, new Date().toISOString(), JSON.stringify(d.days))
  return Number(r.lastInsertRowid)
}

/**
 * Built-in datasets: the colleague's price samples (sample/test-prices, see sample-datasets.ts). They are made again on
 * every start, so a change of the samples reaches an existing database; datasets the user made are left alone.
 */
export function seedDefaults(db: Db): void {
  const names = new Set(SAMPLE_DATASETS.map((s) => s.name))
  for (const r of db.prepare('SELECT id, name FROM test_dataset WHERE built_in=1').all() as { id: number; name: string }[]) {
    if (!names.has(r.name)) db.prepare('DELETE FROM test_dataset WHERE id=?').run(r.id)
  }
  for (const s of SAMPLE_DATASETS) {
    const cur = db.prepare('SELECT id FROM test_dataset WHERE name=?').get(s.name) as { id: number } | undefined
    if (cur) continue
    insertDataset(db, {
      name: s.name,
      description: s.description,
      profile: 'sample',
      chargeMin: SAMPLE_CHARGE_MIN,
      dischargeMin: SAMPLE_DISCHARGE_MIN,
      granularity: s.granularity,
      // Two or more days end on "today", so the yesterday and today questions both have data.
      startOffset: s.days.length > 1 ? -1 : 0,
      builtIn: true,
      region: '',
      days: s.days,
    })
  }
}

export interface DayPreview {
  date: string
  prices: number[]
  stages: Stage[]
}

/** Compute the strategy for a dataset without storing anything. */
export function preview(d: Pick<Dataset, 'days' | 'startOffset' | 'chargeMin' | 'dischargeMin' | 'granularity'>, baseDate?: string) {
  const dates = dayDates(d.startOffset, d.days.length, baseDate)
  const days: DayPreview[] = d.days.map((prices, k) => ({
    date: dates[k],
    prices,
    stages: planDay(prices, d.chargeMin, d.dischargeMin, d.granularity),
  }))
  const strategies: StrategyRow[] = days.flatMap((x) => merge(x.date, x.stages, d.granularity))
  return { days, strategies }
}

export const exampleDay = () => {
  const stages = planDay(BASE, 480, 240, 1)
  return { prices: BASE, stages, chargeMin: 480, dischargeMin: 240, granularity: 1 }
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance } from 'fastify'
import { latestBatch, setConfig, tx, type Db } from '../db.js'
import { body, HttpError, intIn } from '../http.js'
import {
  dayDates,
  exampleDay,
  generateDays,
  getDataset,
  GRANULARITIES,
  insertDataset,
  listDatasets,
  PROFILE_INFO,
  PROFILES,
  preview,
  seedDefaults,
  slotLabel,
  type Dataset,
} from '../test-data.js'
import { addRegion } from '../tasks.js'
import { runGenerate } from './charge-discharge.js'

const BASE_DATE = /^\d{4}-\d{2}-\d{2}$/

function summary(d: Dataset) {
  const { days, ...rest } = d
  return { ...rest, dayCount: days.length, slotsPerDay: days[0]?.length ?? 0 }
}

function nameOf(v: unknown): string {
  if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > 64) throw new HttpError(400, 'name must be 1 to 64 characters')
  return v.trim()
}

/** A region name must be one word (letters, digits, _ or -), so a sentence like "region REGION-B" can name it. */
function regionOf(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v !== 'string' || !/^[\p{L}\p{N}_-]{1,64}$/u.test(v.trim())) throw new HttpError(400, 'region must be 1 to 64 letters (also Chinese), digits, _ or -')
  return v.trim()
}

function textOf(v: unknown): string {
  if (v == null) return ''
  if (typeof v !== 'string' || v.length > 200) throw new HttpError(400, 'description must be at most 200 characters')
  return v
}

function baseDateOf(v: unknown): string | undefined {
  if (v == null || v === '') return undefined
  if (typeof v !== 'string' || !BASE_DATE.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, 'baseDate must be YYYY-MM-DD')
  return v
}

function daysOf(v: unknown, slots: number): number[][] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 14) throw new HttpError(400, 'days must hold 1 to 14 days')
  for (const day of v) {
    if (!Array.isArray(day) || day.length !== slots) throw new HttpError(400, `each day needs exactly ${slots} prices`)
    if (day.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1000)) {
      throw new HttpError(400, 'prices must be numbers from 0 to 1000')
    }
  }
  return v as number[][]
}

function idOf(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id)) throw new HttpError(404, 'not found')
  return id
}

function must(db: Db, raw: string): Dataset {
  const d = getDataset(db, idOf(raw))
  if (!d) throw new HttpError(404, 'not found')
  return d
}

const dup = (e: unknown) => /UNIQUE/i.test((e as Error).message)

/** Make a dataset the latest price batch, with the config it needs and the strategy computed from it. */
export function applyDataset(db: Db, d: Dataset, baseDate?: string) {
  const dates = dayDates(d.startOffset, d.days.length, baseDate)
  return tx(db, () => {
    // The region of the dataset is one tasks can use as soon as its data is the latest.
    if (d.region) addRegion(db, d.region, d.name)
    setConfig(db, 'standby_duration', String(d.chargeMin))
    setConfig(db, 'discharge_duration', String(d.dischargeMin))
    setConfig(db, 'price_granularity', String(d.granularity))
    const batch = latestBatch(db) + 1
    const ins = db.prepare('INSERT INTO price_data(batch_id,price_date,time_slot,price_value) VALUES(?,?,?,?)')
    d.days.forEach((prices, k) => prices.forEach((p, i) => ins.run(batch, dates[k], slotLabel(i, d.granularity), p)))
    const strategies = runGenerate(db, batch)
    return { success: true, batchId: batch, dates, count: d.days.length * d.days[0].length, strategies, message: 'applied' }
  })
}

export function testDataRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/test-data/profiles', async () => PROFILES.map((p) => ({ profile: p, description: PROFILE_INFO[p] })))

  app.get('/api/test-data', async () => listDatasets(db).map(summary))

  app.get<{ Params: { id: string } }>('/api/test-data/:id', async (req) => must(db, req.params.id))

  app.post('/api/test-data', async (req) => {
    const b = body(req)
    const profile = b.profile as (typeof PROFILES)[number]
    if (!PROFILES.includes(profile)) throw new HttpError(400, `profile must be one of ${PROFILES.join(', ')}`)
    const granularity = b.granularity as number
    if (!GRANULARITIES.includes(granularity)) throw new HttpError(400, 'granularity must be 0.25, 0.5 or 1')
    const days = intIn(b.days ?? 1, 'days', 1, 14)
    const seed = intIn(b.seed ?? 1, 'seed', 0, 999999)
    const region = regionOf(b.region)
    try {
      const id = insertDataset(db, {
        region,
        name: nameOf(b.name),
        description: textOf(b.description),
        profile,
        chargeMin: intIn(b.chargeMin ?? 480, 'chargeMin', 1, 1440),
        dischargeMin: intIn(b.dischargeMin ?? 240, 'dischargeMin', 1, 1440),
        granularity,
        startOffset: intIn(b.startOffset ?? 0, 'startOffset', -30, 30),
        builtIn: false,
        days: generateDays(profile, days, granularity, seed),
      })
      // A named region becomes a region tasks can use, so a task can be sent for the data just made.
      if (region) addRegion(db, region, nameOf(b.name))
      return { id, success: true, message: 'created', region }
    } catch (e) {
      if (dup(e)) throw new HttpError(409, 'a dataset with this name already exists')
      throw e
    }
  })

  app.put<{ Params: { id: string } }>('/api/test-data/:id', async (req) => {
    const cur = must(db, req.params.id)
    const b = body(req)
    const days = b.days === undefined ? cur.days : daysOf(b.days, cur.days[0].length)
    const region = b.region === undefined ? cur.region : regionOf(b.region)
    try {
      db.prepare(
        'UPDATE test_dataset SET name=?, description=?, region=?, charge_min=?, discharge_min=?, start_offset=?, days_json=?, updated_at=? WHERE id=?',
      ).run(
        b.name === undefined ? cur.name : nameOf(b.name),
        b.description === undefined ? cur.description : textOf(b.description),
        region,
        b.chargeMin === undefined ? cur.chargeMin : intIn(b.chargeMin, 'chargeMin', 1, 1440),
        b.dischargeMin === undefined ? cur.dischargeMin : intIn(b.dischargeMin, 'dischargeMin', 1, 1440),
        b.startOffset === undefined ? cur.startOffset : intIn(b.startOffset, 'startOffset', -30, 30),
        JSON.stringify(days),
        new Date().toISOString(),
        cur.id,
      )
    } catch (e) {
      if (dup(e)) throw new HttpError(409, 'a dataset with this name already exists')
      throw e
    }
    if (region) addRegion(db, region, b.name === undefined ? cur.name : nameOf(b.name))
    return { success: true, message: 'saved' }
  })

  app.post<{ Params: { id: string } }>('/api/test-data/:id/duplicate', async (req) => {
    const d = must(db, req.params.id)
    const names = new Set(listDatasets(db).map((x) => x.name))
    let name = `${d.name} (copy)`
    for (let k = 2; names.has(name); k++) name = `${d.name} (copy ${k})`
    const id = insertDataset(db, { ...d, name: name.slice(0, 64), builtIn: false })
    return { id, success: true, message: 'duplicated' }
  })

  app.delete<{ Params: { id: string } }>('/api/test-data/:id', async (req) => {
    const d = must(db, req.params.id)
    db.prepare('DELETE FROM test_dataset WHERE id=?').run(d.id)
    return { success: true, message: 'deleted' }
  })

  /** Delete every dataset and bring back the built-in scenarios. */
  app.post('/api/test-data/reset', async () => {
    tx(db, () => {
      db.exec('DELETE FROM test_dataset')
      seedDefaults(db)
    })
    return { success: true, message: 'reset' }
  })

  app.post<{ Params: { id: string } }>('/api/test-data/:id/preview', async (req) => {
    const d = must(db, req.params.id)
    const b = (req.body ?? {}) as Record<string, unknown>
    // A preview may carry unsaved edits, so the page sees the effect before saving.
    const days = b.days === undefined ? d.days : daysOf(b.days, d.days[0].length)
    const chargeMin = b.chargeMin === undefined ? d.chargeMin : intIn(b.chargeMin, 'chargeMin', 1, 1440)
    const dischargeMin = b.dischargeMin === undefined ? d.dischargeMin : intIn(b.dischargeMin, 'dischargeMin', 1, 1440)
    const startOffset = b.startOffset === undefined ? d.startOffset : intIn(b.startOffset, 'startOffset', -30, 30)
    return preview({ days, chargeMin, dischargeMin, startOffset, granularity: d.granularity }, baseDateOf(b.baseDate))
  })

  /** Make the dataset the latest price batch: sets the config, stores the prices, generates the strategy. */
  app.post<{ Params: { id: string } }>('/api/test-data/:id/apply', async (req) => {
    const d = must(db, req.params.id)
    const baseDate = baseDateOf(((req.body ?? {}) as Record<string, unknown>).baseDate)
    return applyDataset(db, d, baseDate)
  })

  /** The design doc worked example with the stages the algorithm picks (used by the Design page). */
  app.get('/api/algorithm/example', async () => exampleDay())
}

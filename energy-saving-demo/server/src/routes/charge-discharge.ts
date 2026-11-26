// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs'
import ExcelJS from 'exceljs'
import { assertSafeExcelJs, HighRiskInputError } from '../guard/high-risk.js'
import type { FastifyInstance } from 'fastify'
import { getConfig, latestBatch, setConfig, tx, type Db } from '../db.js'
import { body, HttpError, intIn } from '../http.js'
import { generate, roundEven, type StrategyRow } from '../strategy.js'

const GRANULARITIES = [0.25, 0.5, 1]

export function runGenerate(db: Db, batchId: number): StrategyRow[] {
  const cfg = getConfig(db)
  const rows = (
    db.prepare('SELECT price_date AS date, time_slot, price_value FROM price_data WHERE batch_id=? ORDER BY price_date, time_slot').all(batchId) as {
      date: string
      time_slot: string
      price_value: number
    }[]
  ).map((r) => [r.date, parseSlot(r.time_slot, cfg.priceGranularity), r.price_value] as [string, number, number])
  const strategies = generate(rows, cfg.standbyDuration, cfg.dischargeDuration, cfg.priceGranularity)
  db.prepare('DELETE FROM charge_discharge_strategy WHERE batch_id=?').run(batchId)
  const ins = db.prepare('INSERT INTO charge_discharge_strategy(batch_id,strategy_date,start_time,end_time,stage) VALUES(?,?,?,?,?)')
  for (const s of strategies) ins.run(batchId, s.date, s.startTime, s.endTime, s.stage)
  return strategies
}

export function latestStrategies(db: Db): { batchId: number; strategies: StrategyRow[] } {
  const b = latestBatch(db)
  const strategies = (
    db.prepare('SELECT strategy_date AS date, start_time, end_time, stage FROM charge_discharge_strategy WHERE batch_id=? ORDER BY id').all(b) as {
      date: string
      start_time: string
      end_time: string
      stage: StrategyRow['stage']
    }[]
  ).map((r) => ({ date: r.date, startTime: r.start_time, endTime: r.end_time, stage: r.stage }))
  return { batchId: b, strategies }
}

function parseSlot(text: unknown, g: number): number {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(text))
  if (!m) throw new Error(`bad time slot '${String(text)}'`)
  return roundEven((Number(m[1]) * 60 + Number(m[2])) / (g * 60))
}

/** Value of an exceljs cell as a plain scalar (formula cells give their result). */
function scalar(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) return v.result
  return v
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function chargeDischargeRoutes(app: FastifyInstance, db: Db, samplePath: string) {
  // ---- system config ----
  app.get('/api/config', async () => getConfig(db))

  app.put('/api/config', async (req) => {
    const b = body(req)
    const standbyDuration = intIn(b.standbyDuration, 'standbyDuration', 1, 1440)
    const dischargeDuration = intIn(b.dischargeDuration, 'dischargeDuration', 1, 1440)
    if (typeof b.priceGranularity !== 'number' || !GRANULARITIES.includes(b.priceGranularity)) {
      throw new HttpError(400, 'priceGranularity must be 0.25, 0.5 or 1')
    }
    tx(db, () => {
      setConfig(db, 'standby_duration', String(standbyDuration))
      setConfig(db, 'discharge_duration', String(dischargeDuration))
      setConfig(db, 'price_granularity', String(b.priceGranularity))
    })
    return { success: true, message: 'saved' }
  })

  // ---- network elements ----
  app.get('/api/network-elements', async () =>
    (
      db.prepare('SELECT * FROM network_element ORDER BY id').all() as {
        id: number
        name: string
        generation_mode: string
        discharge_threshold: number
        target_duration: number | null
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      generationMode: r.generation_mode,
      dischargeThreshold: r.discharge_threshold,
      targetDuration: r.target_duration,
    })),
  )

  app.post('/api/network-elements', async (req) => {
    const b = body(req)
    if (typeof b.name !== 'string' || b.name.length < 1 || b.name.length > 64) {
      throw new HttpError(400, 'name must be 1 to 64 characters')
    }
    const mode = b.generationMode ?? 'Fixed'
    if (mode !== 'Fixed' && mode !== 'Dynamic') throw new HttpError(400, 'generationMode must be Fixed or Dynamic')
    const threshold = intIn(b.dischargeThreshold ?? 80, 'dischargeThreshold', 50, 100)
    const target = b.targetDuration == null ? null : intIn(b.targetDuration, 'targetDuration', 30, 600)
    if (mode === 'Dynamic' && target === null) throw new HttpError(400, 'targetDuration is required in Dynamic mode')
    try {
      const r = db
        .prepare('INSERT INTO network_element(name,generation_mode,discharge_threshold,target_duration) VALUES(?,?,?,?)')
        .run(b.name, mode, threshold, target)
      return { id: Number(r.lastInsertRowid), success: true, message: 'added' }
    } catch (e) {
      if (/UNIQUE/i.test((e as Error).message)) throw new HttpError(409, 'network element name already exists')
      throw e
    }
  })

  app.delete<{ Params: { id: string } }>('/api/network-elements/:id', async (req) => {
    const r = db.prepare('DELETE FROM network_element WHERE id=?').run(Number(req.params.id))
    if (!r.changes) throw new HttpError(404, 'not found')
    return { success: true, message: 'deleted' }
  })

  // ---- prices ----
  app.post('/api/prices/import', async (req) => {
    const file = await req.file()
    if (!file || !file.filename.toLowerCase().endsWith('.xlsx')) throw new HttpError(400, 'only .xlsx files are supported')
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load((await file.toBuffer()) as unknown as ExcelJS.Buffer)
    } catch {
      throw new HttpError(400, 'cannot read workbook')
    }
    try {
      assertSafeExcelJs(wb)
    } catch (e) {
      if (e instanceof HighRiskInputError) throw new HttpError(400, e.message)
      throw e
    }
    const ws = wb.worksheets[0]
    if (!ws) throw new HttpError(400, 'cannot read workbook')
    const g = getConfig(db).priceGranularity

    const recs: [date: string, slot: number, timeSlot: string, price: number][] = []
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i)
      const dv = scalar(row.getCell(1).value)
      if (dv == null || dv === '') continue
      try {
        const date = dv instanceof Date ? dv.toISOString().slice(0, 10) : String(dv).slice(0, 10)
        const slotText = scalar(row.getCell(2).value)
        const pv = scalar(row.getCell(3).value)
        const price = typeof pv === 'number' ? pv : Number(pv)
        if (pv == null || pv === '' || Number.isNaN(price)) throw new Error(`bad price '${String(pv)}'`)
        recs.push([date, parseSlot(slotText, g), String(slotText), price])
      } catch (e) {
        throw new HttpError(400, `row ${i}: ${(e as Error).message}`)
      }
    }
    if (!recs.length) throw new HttpError(400, 'no data rows')

    const perDay = new Map<string, Set<number>>()
    for (const [d, s] of recs) perDay.set(d, (perDay.get(d) ?? new Set()).add(s))
    const need = Math.round(24 / g)
    for (const [d, s] of perDay) {
      if (s.size !== need || [...s].some((x) => x < 0 || x >= need)) {
        throw new HttpError(400, `${d}: slots must cover 00:00-24:00 at ${g}h granularity`)
      }
    }

    return tx(db, () => {
      const batch = latestBatch(db) + 1
      const ins = db.prepare('INSERT INTO price_data(batch_id,price_date,time_slot,price_value) VALUES(?,?,?,?)')
      for (const [d, , t, p] of recs) ins.run(batch, d, t, p)
      const strategies = runGenerate(db, batch)
      return { success: true, count: recs.length, batchId: batch, message: 'imported', strategies }
    })
  })

  app.get<{ Querystring: { date?: string } }>('/api/prices', async (req) => {
    const b = latestBatch(db)
    const date = req.query.date
    const rows = (
      date
        ? db.prepare('SELECT id, batch_id, price_date AS date, time_slot, price_value FROM price_data WHERE batch_id=? AND price_date=? ORDER BY price_date, time_slot').all(b, date)
        : db.prepare('SELECT id, batch_id, price_date AS date, time_slot, price_value FROM price_data WHERE batch_id=? ORDER BY price_date, time_slot').all(b)
    ) as { id: number; batch_id: number; date: string; time_slot: string; price_value: number }[]
    return rows.map((r) => ({ id: r.id, batchId: r.batch_id, date: r.date, timeSlot: r.time_slot, priceValue: r.price_value }))
  })

  app.get('/api/prices/latest-batch', async () => ({ batchId: latestBatch(db) }))

  // ---- strategy ----
  app.post('/api/strategy/generate', async () => {
    const b = latestBatch(db)
    if (!b) throw new HttpError(400, 'no price data imported')
    return { success: true, batchId: b, strategies: tx(db, () => runGenerate(db, b)), message: 'generated' }
  })

  app.get('/api/strategy/latest', async () => latestStrategies(db))

  app.get<{ Querystring: { fmt?: string } }>('/api/strategy/export', async (req, reply) => {
    const { batchId, strategies } = latestStrategies(db)
    if (!strategies.length) throw new HttpError(400, 'no strategy to export')
    const rows: string[][] = [['Date', 'Start time', 'End time', 'Stage'], ...strategies.map((x) => [x.date, x.startTime, x.endTime, x.stage])]
    const name = `strategy-batch${batchId}`
    if (req.query.fmt === 'csv') {
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${name}.csv"`)
        .send(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n')
    }
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Strategy').addRows(rows)
    const buf = Buffer.from(await wb.xlsx.writeBuffer())
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${name}.xlsx"`)
      .send(buf)
  })

  app.get('/api/sample-prices', async (_req, reply) =>
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="price_data.xlsx"')
      .send(createReadStream(samplePath)),
  )
}

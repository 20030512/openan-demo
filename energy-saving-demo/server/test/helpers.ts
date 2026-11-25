// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { buildApp } from '../src/app.js'
import type { Db } from '../src/db.js'
import { createMockMae } from './support/mock-mae.js'
import { rulesLlm } from './support/rules.js'

export const SAMPLE = join(import.meta.dirname, '..', '..', 'sample', 'price_data.xlsx')

export type App = Awaited<ReturnType<typeof buildApp>>

// The server has no mock inside. The tests stand in for the two outside parties: the LLM (rulesLlm answers the prompts with fixed rules) and
// the Network Agent (createMockMae). The LLM settings come from the environment, as they do in a deployment.
process.env.LLM_ENABLED = 'true'
process.env.LLM_PROVIDER = 'openrouter'
process.env.LLM_MODEL = 'test/model'
process.env.LLM_API_KEY = 'sk-test-key-123456'
// The MAE login of the stand-in Network Agent, from the settings as in a deployment (the server keeps it nowhere else).
process.env.MAE_USERNAME = 'demo'
process.env.MAE_PASSWORD = 'demo123'

/** What the stand-in Network Agent needs in the database: its test regions. */
export function testFixtures(db: Db) {
  const ins = db.prepare('INSERT OR IGNORE INTO region VALUES(?,?,?,?)')
  for (const r of [
    ['REGION-A', 'Test region A', 120, 'normal'],
    ['REGION-B', 'Test region B', 86, 'normal'],
    ['REGION-C', 'Test region C', 140, 'normal'],
    ['REGION-D', 'Test region D', 64, 'normal'],
    ['REGION-E', 'Test region E', 210, 'normal'],
    ['Faulty-Demo', 'Test region: the Network Agent fails the task halfway', 5, 'fail'],
    ['Negotiate-Demo', 'Test region: the Network Agent proposes lower targets and waits for the user', 5, 'negotiate'],
    ['Slow-Demo', 'Test region: the task never finishes, so it times out', 5, 'hang'],
  ] as const) ins.run(...r)
}

/** The stand-ins for the two outside parties, as options of buildApp. */
export const standIns = {
  fetch: rulesLlm,
  maeBaseUrl: 'http://mae.test',
  maeFactory: (db: Db) => {
    testFixtures(db)
    return createMockMae(db)
  },
}

/** A fresh app on an in-memory database, with the stand-ins for the LLM and the Network Agent. */
export const makeApp = (fetch: typeof globalThis.fetch = rulesLlm) => buildApp({ dbPath: ':memory:', samplePath: SAMPLE, ...standIns, fetch })

const slot = (i: number, g: number) => {
  const f = (k: number) => {
    const m = Math.round(k * g * 60)
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }
  return `${f(i)}-${f(i + 1)}`
}

/** Rows for a price workbook: one block of 24h / granularity slots per date. */
export function priceRows(dates: string[], prices: (day: number) => number[], g: number): (string | number)[][] {
  return dates.flatMap((d, k) => prices(k).map((p, i) => [d, slot(i, g), p]))
}

/** Build an .xlsx file in memory, with the header row the import expects. */
export async function xlsx(rows: (string | number | Date)[][], header: string[] = ['Date', 'Time slot', 'Price']): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Prices')
  ws.addRow(header)
  rows.forEach((r) => ws.addRow(r))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** POST a file as multipart/form-data to a route. */
export function upload(app: App, url: string, filename: string, data: Buffer, contentType = 'application/octet-stream', headers: Record<string, string> = {}) {
  const boundary = '----testboundary'
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return app.inject({ method: 'POST', url, payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...headers } })
}

export const importXlsx = (app: App, data: Buffer, name = 'p.xlsx') => upload(app, '/api/prices/import', name, data)

export const put = (app: App, url: string, payload: object, headers: Record<string, string> = {}) => app.inject({ method: 'PUT', url, payload, headers })
export const post = (app: App, url: string, payload: object = {}, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload, headers })
export const del = (app: App, url: string, headers: Record<string, string> = {}) => app.inject({ method: 'DELETE', url, headers })

/** The design doc's 24 hourly prices (section 2.7 worked example). */
export const BASE = [0.3, 0.3, 0.3, 0.3, 0.5, 0.5, 0.8, 0.8, 0.9, 0.9, 0.9, 0.9, 0.7, 0.7, 0.6, 0.6, 0.8, 0.8, 1.0, 1.0, 0.9, 0.9, 0.5, 0.4]

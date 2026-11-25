// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * UC1: charge/discharge configuration management. Function tests on the HTTP API, following the
 * requirements FuR001 to FuR005 and the test cases of section 5 of the UC1 design document.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, del, importXlsx, makeApp, post, priceRows, put, upload, xlsx, type App } from './helpers.js'

let app: App
beforeAll(async () => {
  app = await makeApp()
})
afterAll(async () => app.close())

const config = (o: object = {}) => ({ standbyDuration: 480, dischargeDuration: 240, priceGranularity: 0.5, ...o })

describe('FuR001 charge and discharge duration', () => {
  it('TC001 saves the durations and reads them back', async () => {
    const r = await put(app, '/api/config', config({ standbyDuration: 480, dischargeDuration: 240 }))
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ success: true })
    expect((await app.inject('/api/config')).json()).toEqual(config())
  })
  it('has the defaults of the shared tables (300 min, 240 min, 0.5 h)', async () => {
    const fresh = await makeApp()
    expect((await fresh.inject('/api/config')).json()).toEqual(config({ standbyDuration: 300 }))
    await fresh.close()
  })
  it.each([
    ['charge 0', { standbyDuration: 0 }],
    ['discharge -1', { dischargeDuration: -1 }],
    ['charge not a whole number', { standbyDuration: 1.5 }],
    ['charge above a day', { standbyDuration: 1441 }],
    ['granularity 0.3', { priceGranularity: 0.3 }],
    ['granularity as text', { priceGranularity: '0.5' }],
  ])('boundary: %s is rejected and nothing changes', async (_n, bad) => {
    const r = await put(app, '/api/config', config(bad))
    expect(r.statusCode).toBe(400)
    expect(typeof r.json().detail).toBe('string')
    expect((await app.inject('/api/config')).json()).toEqual(config())
  })
  it.each([[0.25], [0.5], [1]])('boundary: granularity %s is accepted', async (g) => {
    expect((await put(app, '/api/config', config({ priceGranularity: g }))).statusCode).toBe(200)
    await put(app, '/api/config', config())
  })
  it('rejects a body that is not JSON object', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/config', headers: { 'content-type': 'application/json' }, payload: '"x"' })
    expect(r.statusCode).toBe(400)
  })
})

describe('FuR002 network elements', () => {
  const ne = (o: object) => post(app, '/api/network-elements', { name: 'NE', generationMode: 'Fixed', dischargeThreshold: 80, ...o })

  it('TC002 adds an element and lists it with its four properties', async () => {
    const r = await ne({ name: 'NE-A', targetDuration: 60 })
    expect(r.statusCode).toBe(200)
    const id = r.json().id as number
    const list = (await app.inject('/api/network-elements')).json() as { id: number }[]
    expect(list.find((x) => x.id === id)).toEqual({ id, name: 'NE-A', generationMode: 'Fixed', dischargeThreshold: 80, targetDuration: 60 })
  })
  it('uses the defaults: mode Fixed, threshold 80', async () => {
    const r = await post(app, '/api/network-elements', { name: 'NE-defaults' })
    const row = ((await app.inject('/api/network-elements')).json() as { id: number; generationMode: string; dischargeThreshold: number }[]).find((x) => x.id === r.json().id)
    expect(row).toMatchObject({ generationMode: 'Fixed', dischargeThreshold: 80 })
  })
  it('TC003 deletes an element, and a second delete says not found', async () => {
    const id = (await ne({ name: 'NE-del' })).json().id as number
    expect((await del(app, `/api/network-elements/${id}`)).statusCode).toBe(200)
    expect(((await app.inject('/api/network-elements')).json() as { id: number }[]).some((x) => x.id === id)).toBe(false)
    expect((await del(app, `/api/network-elements/${id}`)).statusCode).toBe(404)
  })
  it('exception: deleting id 99999 returns not found', async () => {
    const r = await del(app, '/api/network-elements/99999')
    expect(r.statusCode).toBe(404)
    expect(r.json().detail).toMatch(/not found/)
  })
  it('exception: a duplicate name is refused with 409', async () => {
    await ne({ name: 'NE-dup' })
    expect((await ne({ name: 'NE-dup' })).statusCode).toBe(409)
  })
  it.each([
    ['empty name', { name: '' }],
    ['name over 64 characters', { name: 'x'.repeat(65) }],
    ['threshold 49', { name: 'T49', dischargeThreshold: 49 }],
    ['threshold 101', { name: 'T101', dischargeThreshold: 101 }],
    ['target 99999', { name: 'D99999', generationMode: 'Dynamic', targetDuration: 99999 }],
    ['target 29', { name: 'D29', generationMode: 'Dynamic', targetDuration: 29 }],
    ['target 601', { name: 'D601', generationMode: 'Dynamic', targetDuration: 601 }],
    ['invalid mode', { name: 'BadMode', generationMode: 'Turbo' }],
    ['Dynamic without a target', { name: 'DynNoTarget', generationMode: 'Dynamic' }],
  ])('boundary/exception: %s is rejected', async (_n, bad) => {
    expect((await ne(bad)).statusCode).toBe(400)
  })
  it.each([
    ['threshold 50', { name: 'T50', dischargeThreshold: 50 }],
    ['threshold 100', { name: 'T100', dischargeThreshold: 100 }],
    ['target 30', { name: 'D30', generationMode: 'Dynamic', targetDuration: 30 }],
    ['target 600', { name: 'D600', generationMode: 'Dynamic', targetDuration: 600 }],
  ])('boundary: %s is accepted', async (_n, good) => {
    expect((await ne(good)).statusCode).toBe(200)
  })
})

describe('FuR003 price granularity and price import', () => {
  const day = (k: number) => BASE.map((p) => p + k * 0.01)

  it('TC004 imports a 24-row file: count, batch id, strategy generated for the same batch', async () => {
    await put(app, '/api/config', config({ priceGranularity: 1 }))
    const r = await importXlsx(app, await xlsx(priceRows(['2026-10-24'], day, 1)))
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j).toMatchObject({ success: true, count: 24, batchId: 1 })
    expect(j.strategies.length).toBeGreaterThan(0)
    expect((await app.inject('/api/strategy/latest')).json().batchId).toBe(j.batchId)
  })
  it('gives each import a higher batch id and queries only the latest batch', async () => {
    const r = await importXlsx(app, await xlsx(priceRows(['2026-10-25', '2026-10-26'], day, 1)))
    expect(r.json().batchId).toBe(2)
    expect((await app.inject('/api/prices/latest-batch')).json()).toEqual({ batchId: 2 })
    const prices = (await app.inject('/api/prices')).json() as { batchId: number; date: string }[]
    expect(prices).toHaveLength(48)
    expect(new Set(prices.map((p) => p.batchId))).toEqual(new Set([2]))
    expect((await app.inject('/api/prices?date=2026-10-26')).json()).toHaveLength(24)
    expect((await app.inject('/api/strategy/latest')).json().batchId).toBe(2)
  })
  it('reads real Excel date cells', async () => {
    const rows = priceRows(['x'], day, 1).map((r) => [new Date(Date.UTC(2026, 9, 27)), r[1], r[2]])
    const r = await importXlsx(app, await xlsx(rows as (string | number | Date)[][]))
    expect(r.statusCode).toBe(200)
    expect(((await app.inject('/api/prices')).json() as { date: string }[])[0].date).toBe('2026-10-27')
  })
  it('accepts a time slot written as a start time only', async () => {
    const rows = day(0).map((p, i) => ['2026-10-28', `${String(i).padStart(2, '0')}:00`, p])
    expect((await importXlsx(app, await xlsx(rows))).statusCode).toBe(200)
  })
  it('works with the supplied sample file at 0.5 h', async () => {
    await put(app, '/api/config', config())
    const sample = (await app.inject('/api/sample-prices')).rawPayload
    const r = await importXlsx(app, sample)
    expect(r.statusCode).toBe(200)
    expect(r.json().count).toBe(96)
  })
  it('exception: a file with only a header has no data rows', async () => {
    const r = await importXlsx(app, await xlsx([]))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toMatch(/no data rows/)
  })
  it('exception: a wrong file type is refused', async () => {
    expect((await upload(app, '/api/prices/import', 'x.txt', Buffer.from('x'))).statusCode).toBe(400)
  })
  it('exception: a .xlsx name with garbage inside cannot be read', async () => {
    const r = await importXlsx(app, Buffer.from('not a workbook'))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toMatch(/cannot read workbook/)
  })
  it('exception: a request with no file is refused', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/prices/import', payload: {} })
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
    expect(r.statusCode).toBeLessThan(500)
  })
  it('exception: a day that does not cover 00:00-24:00 names the day', async () => {
    const r = await importXlsx(app, await xlsx(priceRows(['2026-11-01'], day, 1).slice(0, 23)))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toMatch(/2026-11-01.*cover 00:00-24:00/)
  })
  it('exception: a bad time slot names the row', async () => {
    const rows = priceRows(['2026-11-02'], day, 1)
    rows[3][1] = 'lunch'
    const r = await importXlsx(app, await xlsx(rows))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toMatch(/row 5/)
  })
  it('exception: a bad price names the row', async () => {
    const rows = priceRows(['2026-11-03'], day, 1)
    rows[0][2] = 'free'
    expect((await importXlsx(app, await xlsx(rows))).json().detail).toMatch(/row 2/)
  })
  it('a failed import leaves the batch number and prices alone', async () => {
    const before = (await app.inject('/api/prices/latest-batch')).json().batchId
    await importXlsx(app, await xlsx(priceRows(['2026-11-04'], day, 1).slice(0, 5)))
    expect((await app.inject('/api/prices/latest-batch')).json().batchId).toBe(before)
  })
  it('performance: about 1000 rows import in under 5 seconds and generate in under 10', async () => {
    await put(app, '/api/config', config({ priceGranularity: 0.25 }))
    const dates = Array.from({ length: 11 }, (_, k) => `2027-01-${String(k + 1).padStart(2, '0')}`)
    const rows = priceRows(dates, (k) => Array.from({ length: 96 }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin((i + k) / 9))), 0.25)
    expect(rows.length).toBeGreaterThanOrEqual(1000)
    const t0 = performance.now()
    const r = await importXlsx(app, await xlsx(rows))
    expect(r.statusCode).toBe(200)
    expect(performance.now() - t0).toBeLessThan(5000)
    const t1 = performance.now()
    expect((await post(app, '/api/strategy/generate')).statusCode).toBe(200)
    expect(performance.now() - t1).toBeLessThan(10000)
    await put(app, '/api/config', config())
  })
})

describe('FuR004 strategy generation', () => {
  it('exception: generate with no price data says so', async () => {
    const fresh = await makeApp()
    const r = await post(fresh, '/api/strategy/generate')
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toBe('no price data imported')
    await fresh.close()
  })
  it('TC005 regenerates from the latest batch with date, start, end and stage on every row', async () => {
    await put(app, '/api/config', config())
    await importXlsx(app, (await app.inject('/api/sample-prices')).rawPayload)
    const r = (await post(app, '/api/strategy/generate')).json()
    expect(r.success).toBe(true)
    expect(r.strategies.length).toBeGreaterThan(0)
    for (const s of r.strategies) {
      expect(s).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), startTime: expect.stringMatching(/^\d\d:\d\d$/), endTime: expect.stringMatching(/^\d\d:\d\d$/), stage: expect.stringMatching(/^(LOW|FLAT|PEAK)$/) })
    }
  })
  it('regenerating does not duplicate rows', async () => {
    const a = (await app.inject('/api/strategy/latest')).json().strategies.length
    await post(app, '/api/strategy/generate')
    await post(app, '/api/strategy/generate')
    expect((await app.inject('/api/strategy/latest')).json().strategies).toHaveLength(a)
  })
  it('a new duration changes the strategy on regenerate', async () => {
    const lows = async () => ((await app.inject('/api/strategy/latest')).json().strategies as { stage: string }[]).filter((s) => s.stage === 'LOW').length
    await put(app, '/api/config', config({ standbyDuration: 120 }))
    await post(app, '/api/strategy/generate')
    const short = await lows()
    await put(app, '/api/config', config({ standbyDuration: 600 }))
    await post(app, '/api/strategy/generate')
    expect(short).not.toBe(await lows())
    await put(app, '/api/config', config())
  })
  it('single price level: no strategy, the whole day stays FLAT', async () => {
    const flat = await xlsx(priceRows(['2027-02-01'], () => Array(48).fill(0.5), 0.5))
    expect((await importXlsx(app, flat)).statusCode).toBe(200)
    const s = (await app.inject('/api/strategy/latest')).json().strategies
    expect(s).toEqual([{ date: '2027-02-01', startTime: '00:00', endTime: '24:00', stage: 'FLAT' }])
  })
})

describe('FuR005 export', () => {
  beforeAll(async () => {
    await importXlsx(app, (await app.inject('/api/sample-prices')).rawPayload)
  })
  it('TC006 exports xlsx by default, with a file name and a download header', async () => {
    const r = await app.inject('/api/strategy/export')
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('spreadsheetml')
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="strategy-batch\d+\.xlsx"/)
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK')
  })
  it('exports csv with a header row and one line per strategy row', async () => {
    const r = await app.inject('/api/strategy/export?fmt=csv')
    expect(r.headers['content-type']).toContain('text/csv')
    const lines = r.body.trim().split(/\r?\n/)
    expect(lines[0]).toBe('Date,Start time,End time,Stage')
    expect(lines).toHaveLength(1 + (await app.inject('/api/strategy/latest')).json().strategies.length)
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},\d\d:\d\d,\d\d:\d\d,(LOW|FLAT|PEAK)$/)
  })
  it('exception: nothing to export before any import', async () => {
    const fresh = await makeApp()
    expect((await fresh.inject('/api/strategy/export')).statusCode).toBe(400)
    await fresh.close()
  })
  it('serves the sample file', async () => {
    const r = await app.inject('/api/sample-prices')
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-disposition']).toContain('price_data.xlsx')
  })
})

describe('API behaviour common to all routes', () => {
  it('answers health with a version', async () => {
    expect((await app.inject('/health')).json()).toMatchObject({ status: 'ok', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) })
  })
  it('errors are { detail: string }', async () => {
    const r = await del(app, '/api/network-elements/123456')
    expect(Object.keys(r.json())).toEqual(['detail'])
  })
  it('unknown routes are 404', async () => {
    expect((await app.inject('/api/nope')).statusCode).toBe(404)
  })
})

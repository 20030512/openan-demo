// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * UC2: Energy-Saving Agent dashboard. Function tests following the interfaces in sections 3.3 and 3.4 and the
 * recommended-question results in section 5 of the UC2 software design.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, importXlsx, makeApp, post, priceRows, put, xlsx, type App } from './helpers.js'

let app: App
beforeAll(async () => {
  app = await makeApp()
})
afterAll(async () => app.close())

describe('3.3.1 getEnergySummary', () => {
  it('returns the fixed statistics of the design', async () => {
    const r = await app.inject('/api/energy-saving/dashboard/energy-summary')
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j.currentConsumption).toBe(300)
    expect(j.totalEnergySavingGain).toBe(14.3)
    expect(j.metrics).toEqual([
      { label: 'Region total', value: 2810, unit: 'kWh', trend: 'down' },
      { label: 'Region daily avg.', value: 390, unit: 'kWh', trend: 'down' },
      { label: 'Per-site daily avg.', value: 18, unit: 'kWh', trend: 'up' },
    ])
    expect(j.gainDistribution.totalSaving).toBe(770.58)
    expect(j.gainDistribution.modes).toEqual([
      { name: 'NR', value: 8245.67, percent: 80.8 },
      { name: 'LTE', value: 1956.08, percent: 19.22 },
    ])
  })
})

describe('3.3.2 getKpi', () => {
  it('returns three suggestion cards', async () => {
    const j = (await app.inject('/api/energy-saving/dashboard/kpi')).json()
    expect(j.suggestionCards).toEqual([
      { label: 'Total', executed: 15000, total: 13000 },
      { label: 'NR', executed: 12500, total: 10000 },
      { label: 'LTE', executed: 2500, total: 3000 },
    ])
  })
  it('returns a 14-day trend (05-01 to 05-14) with suggestion, execution and difference', async () => {
    const t = (await app.inject('/api/energy-saving/dashboard/kpi')).json().trendChart
    expect(t.xAxis).toHaveLength(14)
    expect([t.xAxis[0], t.xAxis[13]]).toEqual(['05-01', '05-14'])
    expect(t.series.map((s: { name: string }) => s.name)).toEqual(['Suggestion', 'Execution', 'Difference'])
    for (const s of t.series) expect(s.data).toHaveLength(14)
    const [sug, exe, diff] = t.series.map((s: { data: number[] }) => s.data)
    sug.forEach((v: number, i: number) => expect(v - exe[i]).toBe(diff[i]))
    for (const v of [...sug, ...exe, ...diff]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(5000)
    }
  })
})

describe('3.3.3 getEnergyCurves', () => {
  it('returns 7 days of energy with total, 5G and 4G, and total = 5G + 4G', async () => {
    const e = (await app.inject('/api/energy-saving/dashboard/energy-curves')).json().energyTrend
    expect(e.xAxis).toEqual(['05-12', '05-13', '05-14', '05-15', '05-16', '05-17', '05-18'])
    const [tot, g5, g4] = e.series.map((s: { data: number[] }) => s.data)
    tot.forEach((v: number, i: number) => expect(g5[i] + g4[i]).toBe(v))
    for (const v of tot) expect(v).toBeLessThanOrEqual(300)
  })
  it('returns 12 two-hourly price and discharge points for 20261022', async () => {
    const p = (await app.inject('/api/energy-saving/dashboard/energy-curves')).json().priceDischarge
    expect(p.date).toBe('20261022')
    expect(p.xAxis).toHaveLength(12)
    expect([p.xAxis[0], p.xAxis[11]]).toEqual(['0:00', '22:00'])
    expect(p.price).toHaveLength(12)
    expect(p.discharge).toHaveLength(12)
  })
})

describe('3.4.1 submitEnergySavingTask', () => {
  beforeAll(async () => {
    await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
    await importXlsx(app, await xlsx(priceRows(['2026-10-24'], () => BASE, 1)))
  })
  const submit = (payload: object) => post(app, '/api/energy-saving/task/submit', payload)
  it('returns success, a task id of the form task-YYYYMMDD-NNNN and a message', async () => {
    const r = await submit({ userInput: 'Create an energy-saving task in region REGION-A' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ success: true, taskId: expect.stringMatching(/^task-\d{8}-\d{4}$/), message: 'Energy-saving task submitted successfully' })
  })
  it('numbers tasks one after another', async () => {
    const a = (await submit({ userInput: 'a task in region REGION-A' })).json().taskId as string
    const b = (await submit({ userInput: 'b task in region REGION-A' })).json().taskId as string
    expect(Number(b.slice(-4))).toBe(Number(a.slice(-4)) + 1)
  })
  it('a text without a region is not sent: the answer asks for the region', async () => {
    const before = (await app.inject('/api/energy-saving/tasks')).json().length
    const r = await submit({ userInput: 'Create an energy-saving task, downlink not lower than 30Mbps' })
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toMatch(/^Which region is the task for\? The sentence names no region, so no task was sent\./)
    expect(r.json().detail).toContain('Known regions: REGION-A')
    expect((await app.inject('/api/energy-saving/tasks')).json()).toHaveLength(before)
  })
  it.each([
    ['empty text', { userInput: '' }],
    ['blank text', { userInput: '   ' }],
    ['missing field', {}],
    ['not a string', { userInput: 5 }],
    ['over 4000 characters', { userInput: 'x'.repeat(4001) }],
  ])('exception: %s is refused', async (_n, bad) => {
    expect((await submit(bad)).statusCode).toBe(400)
  })
  it('accepts exactly 4000 characters', async () => {
    const head = 'Create a task in region REGION-A, 50Mbps '
    expect((await submit({ userInput: head + 'x'.repeat(4000 - head.length) })).statusCode).toBe(200)
  })
})

describe('3.4.2 getEnergySavingEffect', () => {
  it('returns the effect fields of a finished task', async () => {
    process.env.TASK_SIM_MS = '40'
    const id = (await post(app, '/api/energy-saving/task/submit', { userInput: 'Create task in region REGION-A, 50Mbps' })).json().taskId as string
    await new Promise((r) => setTimeout(r, 150))
    const j = (await app.inject(`/api/energy-saving/effect?region=REGION-A&taskId=${id}`)).json()
    delete process.env.TASK_SIM_MS
    expect(j).toEqual({
      region: 'REGION-A',
      energySavingGain: expect.any(Number),
      energySavingGainTarget: expect.any(Number),
      actualEnergySavingPercent: expect.any(Number),
      savedEnergyKwh: 300,
      totalSavingIncome: 100,
      totalSavingIncomePercent: 11,
      currentRateTarget: 50,
      actualRate: 52.4,
      targetAdjustmentSuggestion: expect.any(String),
    })
  })
  it('exception: an unknown task is 404 and a running task is 409', async () => {
    expect((await app.inject('/api/energy-saving/effect?region=REGION-A&taskId=task-1')).statusCode).toBe(404)
    const id = (await post(app, '/api/energy-saving/task/submit', { userInput: 'Create task in region REGION-A' })).json().taskId as string
    expect((await app.inject(`/api/energy-saving/effect?region=REGION-A&taskId=${id}`)).statusCode).toBe(409)
  })
  it.each(['/api/energy-saving/effect', '/api/energy-saving/effect?region=REGION-A', '/api/energy-saving/effect?taskId=t'])('exception: %s needs both parameters', async (url) => {
    expect((await app.inject(url)).statusCode).toBe(400)
  })
})

describe('5 recommended questions: price table and plan table for one day', () => {
  beforeAll(async () => {
    await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
    const dates = ['2026-10-23', '2026-10-24']
    await importXlsx(app, await xlsx(priceRows(dates, (k) => BASE.map((p) => p + k * 0.01), 1)))
  })
  const query = async (day: string) => (await app.inject(`/api/energy-saving/query?day=${day}`)).json()

  it('5.4 price table: date, time slot, price, in time order', async () => {
    const q = await query('2026-10-23')
    expect(q.prices).toHaveLength(24)
    expect(q.prices[0]).toEqual({ date: '2026-10-23', timeSlot: '00:00-01:00', price: 0.3 })
    expect(q.prices[23].timeSlot).toBe('23:00-24:00')
  })
  it('5.4 plan table: only LOW and PEAK rows, FLAT removed', async () => {
    const q = await query('2026-10-23')
    expect(q.plan.length).toBeGreaterThan(0)
    for (const p of q.plan) expect(['LOW', 'PEAK']).toContain(p.stage)
    expect(q.plan[0]).toEqual({ date: '2026-10-23', startTime: expect.any(String), endTime: expect.any(String), stage: expect.any(String) })
  })
  it('returns only the asked day', async () => {
    const a = await query('2026-10-23')
    const b = await query('2026-10-24')
    expect(a.prices.every((p: { date: string }) => p.date === '2026-10-23')).toBe(true)
    expect(b.prices.every((p: { date: string }) => p.date === '2026-10-24')).toBe(true)
    expect(a.prices[0].price).not.toBe(b.prices[0].price)
  })
  it('names the batch it read', async () => {
    expect((await query('2026-10-23')).batchId).toBe((await app.inject('/api/prices/latest-batch')).json().batchId)
  })
  it('a day with no data gives empty tables, not an error', async () => {
    expect(await query('2020-01-01')).toMatchObject({ prices: [], plan: [] })
  })
  it('for each day, the newest batch that holds that day is read', async () => {
    await importXlsx(app, await xlsx(priceRows(['2026-10-30'], () => BASE, 1)))
    expect((await query('2026-10-23')).prices).toHaveLength(24)
    expect((await query('2026-10-30')).prices).toHaveLength(24)
    await importXlsx(app, await xlsx(priceRows(['2026-10-23'], () => BASE.map((p) => p + 1), 1)))
    expect((await query('2026-10-23')).prices[0].price).toBeCloseTo(1.3)
  })
  it.each(['nope', '2026-13-40', '2026-1-1', '', '20261023'])('exception: day "%s" is refused', async (day) => {
    expect((await app.inject(`/api/energy-saving/query?day=${day}`)).statusCode).toBe(400)
  })
  it('exception: a missing day is refused', async () => {
    expect((await app.inject('/api/energy-saving/query')).statusCode).toBe(400)
  })
})

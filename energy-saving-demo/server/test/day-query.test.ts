// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The energy-saving-query skill's call: GET /api/energy-saving/day-query?day=<word or date>&today=<YYYY-MM-DD>.
 * The day words resolve against `today`; the tables are the ones of /api/energy-saving/query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueryDateError, resolveQueryDate } from '../src/query-date.js'
import { BASE, importXlsx, makeApp, priceRows, put, xlsx, type App } from './helpers.js'

const NOW = new Date(2026, 9, 26, 12) // 2026-10-26, local time

describe('resolveQueryDate', () => {
  it.each([
    ['', '2026-10-26'],
    ['today', '2026-10-26'],
    ['Today', '2026-10-26'],
    ['yesterday', '2026-10-25'],
    ['tomorrow', '2026-10-27'],
    ['day before yesterday', '2026-10-24'],
    ['day after tomorrow', '2026-10-28'],
    ['3 days ago', '2026-10-23'],
    ['今天', '2026-10-26'],
    ['昨天', '2026-10-25'],
    ['前天', '2026-10-24'],
    ['明天', '2026-10-27'],
    ['2天前', '2026-10-24'],
    ['2026-10-24', '2026-10-24'],
    ['2026/10/5', '2026-10-05'],
    ['2026.10.5', '2026-10-05'],
    ['20261024', '2026-10-24'],
  ])('%j -> %s', (input, day) => {
    expect(resolveQueryDate(input, NOW)).toBe(day)
  })

  it('crosses month and year ends', () => {
    expect(resolveQueryDate('yesterday', new Date(2026, 0, 1))).toBe('2025-12-31')
    expect(resolveQueryDate('tomorrow', new Date(2026, 1, 28))).toBe('2026-03-01')
  })

  it.each(['2026-13-45', '2026-02-30', 'Oct 24', 'last monday', '12345', 'price'])('refuses %j instead of guessing today', (input) => {
    expect(() => resolveQueryDate(input, NOW)).toThrow(QueryDateError)
  })
})

describe('GET /api/energy-saving/day-query', () => {
  let app: App
  beforeAll(async () => {
    app = await makeApp()
    await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
    await importXlsx(app, await xlsx(priceRows(['2026-10-25', '2026-10-26'], (k) => BASE.map((p) => p + k * 0.01), 1)))
  })
  afterAll(async () => app.close())
  const get = (qs: string) => app.inject(`/api/energy-saving/day-query?${qs}`)

  it('today: the price table, the plan table and a summary of the day', async () => {
    const r = await get('day=today&today=2026-10-26')
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j).toMatchObject({ day: '2026-10-26', input: 'today' })
    expect(j.prices).toHaveLength(24)
    expect(j.prices[0]).toEqual({ date: '2026-10-26', timeSlot: '00:00-01:00', price: 0.31 })
    expect(j.plan.length).toBeGreaterThan(0)
    for (const p of j.plan) expect(['LOW', 'PEAK']).toContain(p.stage)
    expect(j.summary.slots).toBe(24)
    expect(j.summary.min).toEqual({ price: 0.31, timeSlots: ['00:00-01:00', '01:00-02:00', '02:00-03:00', '03:00-04:00'] })
    expect(j.summary.max).toEqual({ price: 1.01, timeSlots: ['18:00-19:00', '19:00-20:00'] })
    expect(j.availableDates).toBeUndefined()
  })

  it('gives the same tables as /api/energy-saving/query for that day', async () => {
    const words = (await get('day=yesterday&today=2026-10-26')).json()
    const plain = (await app.inject('/api/energy-saving/query?day=2026-10-25')).json()
    expect(words.day).toBe('2026-10-25')
    expect({ prices: words.prices, plan: words.plan, batchId: words.batchId }).toEqual({ prices: plain.prices, plan: plain.plan, batchId: plain.batchId })
  })

  it.each([
    ['day=2026-10-25', '2026-10-25'],
    [`day=${encodeURIComponent('昨天')}&today=2026-10-26`, '2026-10-25'],
    [`day=${encodeURIComponent('day before yesterday')}&today=2026-10-27`, '2026-10-25'],
  ])('%s -> %s', async (qs, day) => {
    expect((await get(qs)).json().day).toBe(day)
  })

  it('a day without data: empty tables and the days that have prices', async () => {
    const j = (await get('day=2020-01-01')).json()
    expect(j).toMatchObject({ day: '2020-01-01', prices: [], plan: [], summary: null, availableDates: ['2026-10-25', '2026-10-26'] })
  })

  it.each(['Oct%2024', '2026-02-30', 'nope'])('a day it cannot read (%s) is refused, not guessed', async (day) => {
    const r = await get(`day=${day}`)
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toBeTruthy()
  })

  it('a wrong today is refused', async () => {
    expect((await get('day=today&today=26.10.2026')).statusCode).toBe(400)
  })
})

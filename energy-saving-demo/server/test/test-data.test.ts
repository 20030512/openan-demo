// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { standIns } from './helpers.js'
import { isoDate } from '../src/test-data.js'

const SAMPLE = join(import.meta.dirname, '..', '..', 'sample', 'price_data.xlsx')

describe('test data management', () => {
  let a: Awaited<ReturnType<typeof buildApp>>
  beforeAll(async () => {
    a = await buildApp({ dbPath: ':memory:', samplePath: SAMPLE })
  })
  afterAll(async () => a.close())

  const list = async () => (await a.inject('/api/test-data')).json() as { id: number; name: string; builtIn: boolean; slotsPerDay: number }[]
  const byName = async (n: string) => (await list()).find((x) => x.name === n)!
  const post = (url: string, payload: object = {}) => a.inject({ method: 'POST', url, payload })

  it('seeds the built-in scenarios', async () => {
    const l = await list()
    expect(l).toHaveLength(36) // the colleague's price samples
    expect(l.every((x) => x.builtIn)).toBe(true)
    expect(l.map((x) => x.name)).toEqual(expect.arrayContaining(['A1 tiered-tariff', 'F1 TC004-doc-example', 'D1 single-tier', 'D2 two-tiers', 'E4 mixed-week']))
    expect((await a.inject('/api/test-data/profiles')).json()).toHaveLength(7)
  })

  it('previews the doc example like the algorithm', async () => {
    const d = await byName('F1 TC004-doc-example')
    const p = (await post(`/api/test-data/${d.id}/preview`)).json()
    const stages: string[] = p.days[0].stages
    expect(stages.filter((s) => s === 'PEAK')).toHaveLength(4)
    expect(stages.filter((s) => s === 'LOW')).toHaveLength(6) // 5 h of charge plus the last slot (expected result of F1)
  })

  it('gives the expected shape for the special scenarios', async () => {
    const flat = (await post(`/api/test-data/${(await byName('D1 single-tier')).id}/preview`)).json()
    expect(flat.strategies).toHaveLength(2) // two days, each one FLAT row
    expect(flat.strategies.every((x: { stage: string }) => x.stage === 'FLAT')).toBe(true)
    const two = (await post(`/api/test-data/${(await byName('D2 two-tiers')).id}/preview`)).json()
    expect(two.strategies.some((s: { stage: string }) => s.stage === 'FLAT')).toBe(false)
  })

  it('creates, edits, duplicates and deletes a dataset', async () => {
    const c = await post('/api/test-data', { name: 'Mine', profile: 'single-peak', granularity: 1, days: 2 })
    expect(c.statusCode).toBe(200)
    const id = c.json().id as number
    expect((await post('/api/test-data', { name: 'Mine', profile: 'flat', granularity: 1 })).statusCode).toBe(409)
    expect((await post('/api/test-data', { name: 'x', profile: 'nope', granularity: 1 })).statusCode).toBe(400)
    expect((await post('/api/test-data', { name: 'x', profile: 'flat', granularity: 0.3 })).statusCode).toBe(400)

    const full = (await a.inject(`/api/test-data/${id}`)).json()
    expect(full.days).toHaveLength(2)
    expect(full.days[0]).toHaveLength(24)
    const days = full.days.map((d: number[]) => d.map(() => 0.5))
    days[0][3] = 0.9
    const put = (payload: object) => a.inject({ method: 'PUT', url: `/api/test-data/${id}`, payload })
    expect((await put({ name: 'Mine 2', days })).statusCode).toBe(200)
    expect((await put({ days: [[1, 2]] })).statusCode).toBe(400)
    expect((await put({ days: [Array(24).fill(-1)] })).statusCode).toBe(400)
    expect((await a.inject(`/api/test-data/${id}`)).json().days[0][3]).toBe(0.9)

    const dupe = await post(`/api/test-data/${id}/duplicate`)
    expect((await a.inject(`/api/test-data/${dupe.json().id}`)).json().name).toBe('Mine 2 (copy)')
    expect((await a.inject({ method: 'DELETE', url: `/api/test-data/${id}` })).statusCode).toBe(200)
    expect((await a.inject({ method: 'DELETE', url: `/api/test-data/${id}` })).statusCode).toBe(404)
    expect((await a.inject('/api/test-data/abc')).statusCode).toBe(404)
  })

  it('previews unsaved edits without storing them', async () => {
    const d = await byName('F1 TC004-doc-example')
    const p = (await post(`/api/test-data/${d.id}/preview`, { days: [Array(24).fill(0.5)] })).json()
    expect(p.strategies).toHaveLength(1)
    expect((await a.inject(`/api/test-data/${d.id}`)).json().days[0][0]).toBe(0.3)
  })

  it('applies a dataset so the dashboard query returns it', async () => {
    const d = await byName('E4 mixed-week')
    const r = (await post(`/api/test-data/${d.id}/apply`, { baseDate: '2026-10-24' })).json()
    expect(r).toMatchObject({ success: true, dates: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], count: 336 })
    const q = (await a.inject('/api/energy-saving/query?day=2026-10-23')).json()
    expect(q.batchId).toBe(r.batchId)
    expect(q.prices).toHaveLength(48)
    expect(q.plan.length).toBeGreaterThan(0)
    expect((await a.inject('/api/config')).json()).toMatchObject({ standbyDuration: 300, priceGranularity: 0.5 })
    // the server date is used when no baseDate is given
    const r2 = (await post(`/api/test-data/${d.id}/apply`)).json()
    expect(r2.dates[1]).toBe(isoDate(new Date()))
    expect((await post(`/api/test-data/${d.id}/apply`, { baseDate: 'bad' })).statusCode).toBe(400)
  })

  it('creates test data with a region name; the region can then be used by a task', async () => {
    const r = await post('/api/test-data', { name: 'With region', profile: 'flat', granularity: 1, region: 'REGION-F' })
    expect(r.json()).toMatchObject({ success: true, region: 'REGION-F' })
    expect((await a.inject('/api/regions')).json().map((x: { name: string }) => x.name)).toContain('REGION-F')
    expect((await a.inject(`/api/test-data/${r.json().id}`)).json().region).toBe('REGION-F')
    // the same name again is fine and does not double the region
    await post('/api/test-data', { name: 'With region 2', profile: 'flat', granularity: 1, region: 'region-f' })
    expect((await a.inject('/api/regions')).json().filter((x: { name: string }) => x.name.toLowerCase() === 'region-f')).toHaveLength(1)
    // no region: nothing is added
    const before = (await a.inject('/api/regions')).json().length
    await post('/api/test-data', { name: 'No region', profile: 'flat', granularity: 1 })
    expect((await a.inject('/api/regions')).json()).toHaveLength(before)
  })

  it('any dataset, also a built-in one, can be given a region; it works after save and after apply', async () => {
    const d = await byName('A1 tiered-tariff')
    const names = async () => (await a.inject('/api/regions')).json().map((x: { name: string }) => x.name)
    expect(await names()).not.toContain('REGION-B')
    expect((await a.inject({ method: 'PUT', url: `/api/test-data/${d.id}`, payload: { region: 'REGION-B' } })).statusCode).toBe(200)
    expect(await names()).toContain('REGION-B')
    expect((await a.inject(`/api/test-data/${d.id}`)).json().region).toBe('REGION-B')
    expect((await a.inject({ method: 'PUT', url: `/api/test-data/${d.id}`, payload: { region: 'bad name' } })).statusCode).toBe(400)
    expect((await post(`/api/test-data/${d.id}/apply`)).statusCode).toBe(200)
    expect(await names()).toContain('REGION-B')
  })

  it('refuses a region name that a sentence could not carry', async () => {
    for (const region of ['two words', 'a/b', 'x'.repeat(65), 5]) {
      expect((await post('/api/test-data', { name: 'Bad region', profile: 'flat', granularity: 1, region })).statusCode).toBe(400)
    }
  })

  it('resets to the built-in scenarios', async () => {
    await post('/api/test-data', { name: 'Temp', profile: 'flat', granularity: 1 })
    expect((await post('/api/test-data/reset')).statusCode).toBe(200)
    const l = await list()
    expect(l.find((x) => x.name === 'Temp')).toBeUndefined()
    expect(l).toHaveLength(36)
  })

  it('serves the algorithm example', async () => {
    const e = (await a.inject('/api/algorithm/example')).json()
    expect(e.prices).toHaveLength(24)
    expect(e.stages.filter((s: string) => s === 'PEAK')).toHaveLength(4)
  })
})

describe('a fresh server database has prices, so a task works at once', () => {
  it('applies the first sample dataset when there are no prices, once', async () => {
    const a = await buildApp({ dbPath: ':memory:', samplePath: SAMPLE, seedPrices: true, ...standIns })
    const q = (await a.inject(`/api/energy-saving/query?day=${isoDate(new Date())}`)).json()
    expect(q.prices).toHaveLength(48)
    expect(q.plan.length).toBeGreaterThan(0)
    const r = (await a.inject({ method: 'POST', url: '/api/energy-saving/task/submit', payload: { userInput: 'Create task in region REGION-A, 50Mbps, reserve 50%' } })).json()
    expect(r).toMatchObject({ success: true, taskId: expect.stringMatching(/^task-/) })
    await a.close()
  })
  it('does not seed unless asked (the tests rely on an empty start)', async () => {
    const a = await buildApp({ dbPath: ':memory:', samplePath: SAMPLE })
    expect((await a.inject(`/api/energy-saving/query?day=${isoDate(new Date())}`)).json().prices).toHaveLength(0)
    await a.close()
  })
})

describe('a Chinese region name for new test data', () => {
  it('is accepted and becomes a region a task can use', async () => {
    const a = await buildApp({ dbPath: ':memory:', samplePath: SAMPLE, seedPrices: true, ...standIns })
    const r = await a.inject({ method: 'POST', url: '/api/test-data', payload: { name: 'Chinese name', profile: 'flat', granularity: 1, region: '示例区' } })
    expect(r.json()).toMatchObject({ success: true, region: '示例区' })
    const t = (await a.inject({ method: 'POST', url: '/api/energy-saving/task/submit', payload: { userInput: '创建节能任务，区域 示例区；速率 50Mbps' } })).json()
    expect(t).toMatchObject({ success: true })
    const names = (await a.inject('/api/regions')).json().map((x: { name: string }) => x.name)
    expect(names).toContain('示例区')
    expect(names).not.toContain('XX')
    await a.close()
  })
})

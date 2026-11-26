// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Dialog intent routing (design doc 1.2, 3.2): one text box, three skill features, parameters extracted from the text.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatRateSegments, parseRateSegments, rateRanges } from '../src/intent.js'
import { classify, extractTaskParams, parseDay, rulesLlm } from './support/rules.js'
import { BASE, importXlsx, makeApp, post, priceRows, put, xlsx, type App } from './helpers.js'

const NOW = new Date('2026-10-24T12:00:00')
const TASK =
  "Create an energy-saving task in region REGION-A; idle hours 0~6 o'clock rate guarantee target 2Mbps; during non-idle hours the downlink rate must be guaranteed to be not lower than 50MBPS. Allow enabling the Li-ion battery charge/discharge power-cost-saving function based on dynamic electricity prices, and ensure the reserved backup power ratio is not lower than 50%"

describe('classify', () => {
  it.each([
    [TASK, 'submit-task'],
    ['在区域REGION-A创建节能任务，非闲时速率不低于50MBPS，备电比例不低于50%', 'submit-task'],
    ['create an energy saving task', 'submit-task'],
    ["Query today's dynamic electricity price", 'query-price'],
    ['查询昨天的电价', 'query-price'],
    ["Query today's Li-ion battery charge/discharge slots", 'query-plan'],
    ['查询今天锂电充放电时段', 'query-plan'],
    ["Query today's dynamic electricity price and Li-ion battery charge/discharge slot plan", 'query-both'],
    ['what is the weather', 'unknown'],
  ])('%s -> %s', (text, intent) => expect(classify(text)).toBe(intent))
})

describe('parseDay', () => {
  it.each([
    ['today', '2026-10-24'],
    ['查询昨天的电价', '2026-10-23'],
    ['prices for yesterday', '2026-10-23'],
    ['tomorrow', '2026-10-25'],
    ['price on 2026-11-02', '2026-11-02'],
    ['price on 20261102', '2026-11-02'],
    ['price', '2026-10-24'],
  ])('%s -> %s', (text, day) => expect(parseDay(text, NOW)).toBe(day))
})

describe('extractTaskParams', () => {
  it('takes region, the highest rate and the reserve ratio', () => {
    // the idle hours of the sentence become the time segments of the target (design 3.2.2 step 1)
    expect(extractTaskParams(TASK)).toEqual({ region: 'REGION-A', rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 })
    expect(extractTaskParams('in region REGION-B, rate 10 Mbps, reserve 30%')).toEqual({ region: 'REGION-B', rateMbps: [{"timeRange":"00:00~24:00","target":"10Mbps"}], reserveBackupRatio: 30 })
  })
  it('falls back to the default rate and ratio, and has no region', () => expect(extractTaskParams('create a task')).toEqual({ region: '', rateMbps: [{"timeRange":"00:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 }))
})

describe('POST /api/energy-saving/chat', () => {
  let app: App
  beforeAll(async () => {
    app = await makeApp()
    await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
    await importXlsx(app, await xlsx(priceRows(['2026-10-24'], () => BASE, 1)))
  })
  afterAll(async () => app.close())

  it('submits a task and returns the extracted parameters', async () => {
    const r = await post(app, '/api/energy-saving/chat', { message: TASK })
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j.intent).toBe('submit-task')
    expect(j.success).toBe(true)
    expect(j.taskId).toMatch(/^task-\d{8}-\d{4}$/)
    expect(j.params).toEqual({ region: 'REGION-A', rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 })
  })
  it('answers a price question from the database', async () => {
    const j = (await post(app, '/api/energy-saving/chat', { message: "Query today's dynamic electricity price", today: '2026-10-24' })).json()
    expect(j.intent).toBe('query-price')
    expect(j.day).toBe('2026-10-24')
    expect(j.prices).toHaveLength(24)
  })
  it('answers a plan question without FLAT rows', async () => {
    const j = (await post(app, '/api/energy-saving/chat', { message: '查询今天锂电充放电时段', today: '2026-10-24' })).json()
    expect(j.intent).toBe('query-plan')
    expect(j.plan.length).toBeGreaterThan(0)
    expect(j.plan.every((p: { stage: string }) => p.stage !== 'FLAT')).toBe(true)
  })
  it('"I want to see one previous day data": both tables of the day before, the day is the one the LLM worked out', async () => {
    const j = (await post(app, '/api/energy-saving/chat', { message: 'I want to see one previous day data', today: '2026-10-25' })).json()
    expect(j.intent).toBe('query-both')
    expect(j.day).toBe('2026-10-24')
    expect(j.prices).toHaveLength(24)
    expect(j.plan.length).toBeGreaterThan(0)
  })
  it('the server does not second-guess the date of the LLM, and uses today when the LLM gives none', async () => {
    const answer = (content: string): typeof fetch => async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
      if (!body.messages[0].content.includes('Today is')) return rulesLlm(url, init)
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    }
    const ask = async (content: string, message: string) => {
      const local = await makeApp(answer(content))
      try {
        await put(local, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
        await importXlsx(local, await xlsx(priceRows(['2026-10-24'], () => BASE, 1)))
        return (await post(local, '/api/energy-saving/chat', { message, today: '2026-10-25' })).json()
      } finally {
        await local.close()
      }
    }
    expect((await ask('{"intents":["query-price"],"date":"2026-10-24"}', 'show the price of last Friday')).day).toBe('2026-10-24') // any wording: the model decides
    expect((await ask('{"intents":["query-price"],"date":"2026-01-01"}', 'show the price of the previous day')).day).toBe('2026-01-01') // taken as given
    expect((await ask('{"intents":["query-price"]}', 'show the price of the previous day')).day).toBe('2026-10-25') // no date from the model: today
    expect((await ask('{"intents":["query-price"],"date":"yesterday"}', 'show the price of the previous day')).day).toBe('2026-10-25') // not a date: today
  })
  it('returns empty tables for a day with no data', async () => {
    const j = (await post(app, '/api/energy-saving/chat', { message: 'price for yesterday', today: '2026-10-24' })).json()
    expect(j.day).toBe('2026-10-23')
    expect(j.prices).toEqual([])
  })
  it('explains what it can do when the text is not understood', async () => {
    const j = (await post(app, '/api/energy-saving/chat', { message: 'hello there' })).json()
    expect(j.intent).toBe('unknown')
  })
  it.each([[{}], [{ message: '' }], [{ message: 'x'.repeat(4001) }]])('rejects bad input %j', async (b) => {
    expect((await post(app, '/api/energy-saving/chat', b)).statusCode).toBe(400)
  })
})

describe('there is no default region, and region names may be Chinese', () => {
  it('has no region when the text names none', () => {
    expect(extractTaskParams('create an energy-saving task, 50Mbps').region).toBe('')
  })
  it('reads a Chinese or an English region name up to the next punctuation', () => {
    expect(extractTaskParams('创建节能任务，区域 REGION-A；速率 50Mbps').region).toBe('REGION-A')
    expect(extractTaskParams('Create a task in region 示例-甲区, 50Mbps').region).toBe('示例-甲区')
    expect(extractTaskParams('region REGION-B, rate 10 Mbps').region).toBe('REGION-B')
    // no space after a Chinese name: it ends before 创建
    expect(extractTaskParams('在区域REGION-A创建节能任务，非闲时不低于50MBPS').region).toBe('REGION-A')
    expect(extractTaskParams('在区域test创建节能任务').region).toBe('test')
  })
})

describe('time segments of the rate (design 3.2.2 step 1)', () => {
  it('reads idle hours in English and in Chinese into the rateMbps text', () => {
    expect(extractTaskParams("idle hours 2~5 o'clock rate guarantee 3Mbps, non-idle at least 40Mbps").rateMbps).toEqual([{"timeRange":"00:00~02:00","target":"40Mbps"},{"timeRange":"02:00~05:00","target":"3Mbps"},{"timeRange":"05:00~24:00","target":"40Mbps"}])
    expect(extractTaskParams('闲时0~6点速率保障目标2Mbps，非闲时不低于50Mbps').rateMbps).toEqual([{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}])
  })
  it('without idle hours the rate is one range for the whole day', () => {
    expect(extractTaskParams('create a task in region A, 50Mbps').rateMbps).toEqual([{"timeRange":"00:00~24:00","target":"50Mbps"}])
  })
  it('parses the JSON form of rateMbps, also with escaped quotes', () => {
    const want = [{ start: '00:00', end: '06:00', mbps: 2 }, { start: '06:00', end: '24:00', mbps: 50 }]
    expect(parseRateSegments('[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}]')).toEqual(want)
    expect(parseRateSegments('[{\\"timeRange\\":\\"00:00~06:00\\",\\"target\\":\\"2Mbps\\"},{\\"timeRange\\":\\"06:00~24:00\\",\\"target\\":\\"50Mbps\\"}]')).toEqual(want)
    expect(rateRanges(want)).toEqual([{ timeRange: '00:00~06:00', target: '2Mbps' }, { timeRange: '06:00~24:00', target: '50Mbps' }])
    expect(parseRateSegments(rateRanges(want))).toEqual(want) // it reads back what it writes
  })
  it.each([
    ['the older {"range":rate} form', '[{"00:00~06:00":2},{"06:00~24:00":50}]'],
    ['a time range that is not a range', '[{"timeRange":"morning","target":"2Mbps"}]'],
    ['a target that is not a rate', '[{"timeRange":"00:00~06:00","target":"fast"}]'],
    ['no target', '[{"timeRange":"00:00~06:00"}]'],
    ['a rate of zero', '[{"timeRange":"00:00~06:00","target":"0Mbps"}]'],
  ])('refuses JSON with %s', (_n, text) => {
    expect(parseRateSegments(text)).toEqual([])
  })
  it('reads the example answer of the parameters prompt, with its space before the time', () => {
    const answer = '[{"timeRange":" 00:00~06:00", "target": "2Mbps"},{"timeRange": "06:00~24:00","target": "50Mbps"}]'
    expect(rateRanges(parseRateSegments(answer))).toEqual([{ timeRange: '00:00~06:00', target: '2Mbps' }, { timeRange: '06:00~24:00', target: '50Mbps' }])
  })
  it('does not read the old text form {00:00~06:00,2Mbps}', () => {
    expect(parseRateSegments('{00:00~06:00,2Mbps},{06:00~24:00,50Mbps}')).toEqual([])
    expect(formatRateSegments(parseRateSegments('[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}]'))).toBe('{00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}')
  })
  it.each([['overlapping', '[{"timeRange":"00:00~08:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}]'], ['backwards', '[{"timeRange":"06:00~02:00","target":"2Mbps"}]'], ['past the day', '[{"timeRange":"00:00~25:00","target":"2Mbps"}]'], ['a zero rate', '[{"timeRange":"00:00~06:00","target":"0Mbps"}]']])('refuses %s segments', (_n, text) => {
    expect(parseRateSegments(text)).toEqual([])
  })
})

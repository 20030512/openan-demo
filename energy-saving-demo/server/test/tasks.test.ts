// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Regions, tasks with a real state (read from the Network Agent), several actions in one message, and the AI config file.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allDayRate, rateRanges } from '../src/intent.js'
import { classifyAll } from './support/rules.js'

const fixed = (n: number) => rateRanges(allDayRate(n)) // one rate for the whole day
import { loadConfig } from '../src/llm.js'
import { openDb } from '../src/db.js'
import { createMockMae } from './support/mock-mae.js'
import { createSkill, SkillError } from '../src/skills/energy-saving/index.js'
import { answerProposal, initTaskTables, readTask, recordTask } from '../src/tasks.js'
import { BASE, importXlsx, makeApp, post, priceRows, put, testFixtures, xlsx, type App } from './helpers.js'

describe('classifyAll: several actions in one sentence', () => {
  it.each([
    ['Create a task in region A and show today\'s price and plan', ['submit-task', 'query-both']],
    ['create an energy-saving task, then check the electricity price', ['submit-task', 'query-price']],
    ['创建节能任务，并查询今天的充放电规划', ['submit-task', 'query-plan']],
    ["Query today's dynamic electricity price", ['query-price']],
    ['price and charge plan yesterday', ['query-both']],
    ['hello', ['unknown']],
  ])('%s', (text, want) => expect(classifyAll(text)).toEqual(want))
  it('a task sentence that only mentions prices is just a task', () => {
    const t =
      "Create an energy-saving task in region REGION-A; idle hours 0~6 o'clock rate guarantee target 2Mbps; during non-idle hours the downlink rate must be guaranteed to be not lower than 50MBPS. Allow enabling the Li-ion battery charge/discharge power-cost-saving function based on dynamic electricity prices, and ensure the reserved backup power ratio is not lower than 50%"
    expect(classifyAll(t)).toEqual(['submit-task'])
  })
})

describe('task state, read from the mock Network Agent', () => {
  const db = openDb(':memory:')
  initTaskTables(db)
  testFixtures(db)
  db.prepare("INSERT INTO charge_discharge_strategy(batch_id,strategy_date,start_time,end_time,stage) VALUES(1,'2026-10-24','00:00','08:00','LOW'),(1,'2026-10-24','08:00','18:00','FLAT'),(1,'2026-10-24','18:00','22:00','PEAK')").run()
  let clock = 1_800_000_000_000
  const t0 = clock
  const skill = createSkill(db, createMockMae(db, () => clock), 'http://mae.mock')
  const make = async (region: string, text = 'x') => {
    clock = t0
    const a2aTaskId = await skill.submitTask({ region, rateMbps: fixed(50), reserveBackupRatio: 50 })
    return recordTask(db, { a2aTaskId, text, region, rateMbps: fixed(50), reserveBackupRatio: 50 }, t0)
  }
  const at = async (id: string, ms: number) => {
    clock = t0 + ms
    return readTask(db, id, skill, t0 + ms)
  }

  it('goes sent, working, then completed with the report of the Task-T Expected Output', async () => {
    const id = await make('REGION-A')
    expect(await at(id, 0)).toMatchObject({ state: 'sent', progress: 20, final: false })
    expect(await at(id, 1500)).toMatchObject({ state: 'working', progress: 60 })
    const done = (await at(id, 5000))!
    expect(done).toMatchObject({ state: 'completed', progress: 100, final: true })
    expect(done.report).toMatchObject({ region: 'REGION-A', currentRateTarget: 50, actualRate: 52.4, energySavingGain: 14.3, simulation: true })
  })
  it('a final state never changes again', async () => {
    const id = await make('REGION-A')
    await at(id, 6000)
    expect((await at(id, 10 * 3600_000))!.state).toBe('completed')
  })
  it('the test region fails halfway, with the reason', async () => {
    const id = await make('Faulty-Demo')
    expect(await at(id, 6000)).toMatchObject({ state: 'failed', final: true, error: expect.stringContaining('rejected') })
  })
  it('the slow test region keeps working, then times out after the limit', async () => {
    const id = await make('Slow-Demo')
    expect(await at(id, 60_000)).toMatchObject({ state: 'working', progress: 60, final: false })
    expect(await at(id, 121_000)).toMatchObject({ state: 'timed_out', final: true, error: expect.stringContaining('120 s') })
  })
  it('the negotiating region stops at input_required with a high-risk proposal and waits', async () => {
    const id = await make('Negotiate-Demo')
    const v = (await at(id, 3000))!
    expect(v).toMatchObject({ state: 'input_required', progress: 60, final: false })
    expect(v.proposal).toMatchObject({ type: 'Negotiation-T', risk: 'HIGH', savingTarget: { from: 10, to: 8 }, speedGuarantee: { from: 50, to: 25 } })
    expect((await at(id, 60_000))!.state).toBe('input_required') // never accepted by itself
  })
  it('accepting the proposal lets the task go on and complete', async () => {
    const id = await make('Negotiate-Demo')
    await at(id, 3000)
    expect(await answerProposal(db, id, true, skill)).toMatchObject({ state: 'working' })
    const done = (await at(id, 6000))!
    expect(done).toMatchObject({ state: 'completed', final: true })
    expect(done.proposal).toBeUndefined()
  })
  it('rejecting the proposal ends the task as failed with the reason', async () => {
    const id = await make('Negotiate-Demo')
    await at(id, 3000)
    expect(await answerProposal(db, id, false, skill)).toMatchObject({ state: 'failed', final: true, error: expect.stringContaining('rejected') })
  })
  it('only a task that waits for an answer can be answered', async () => {
    const id = await make('REGION-A')
    await at(id, 1500)
    await expect(answerProposal(db, id, true, skill)).rejects.toMatchObject({ status: 409 })
    expect(await answerProposal(db, 'task-nope', true, skill)).toBeUndefined()
  })
  it('numbers tasks of one day one after another; an unknown task is undefined', async () => {
    const a = await make('REGION-A')
    const b = await make('REGION-A')
    expect(Number(b.slice(-4))).toBe(Number(a.slice(-4)) + 1)
    expect(await readTask(db, 'task-nope', skill)).toBeUndefined()
  })
  it('an unknown region is refused by the Network Agent, and the answer names the known ones', async () => {
    await expect(make('Atlantis')).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Atlantis.*not a known region.*REGION-B/) })
  })
  it('region names ignore case', async () => expect((await at(await make('region-b'), 0))!.region).toBe('REGION-B'))
  it('without a strategy there is nothing to send (design 10)', async () => {
    const empty = openDb(':memory:')
    initTaskTables(empty)
    const s = createSkill(empty, createMockMae(empty), 'http://mae.mock')
    await expect(s.submitTask({ region: 'REGION-A', rateMbps: fixed(50), reserveBackupRatio: 50 })).rejects.toMatchObject({
      status: 409,
      message: 'The charge/discharge strategy has not been generated, please import electricity price data first',
    })
    expect(SkillError).toBeDefined()
  })
})

describe('regions, tasks and chat with several actions over HTTP', () => {
  let app: App
  beforeAll(async () => {
    app = await makeApp()
    await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
    await importXlsx(app, await xlsx(priceRows(['2026-10-24'], () => BASE, 1)))
  })
  afterAll(async () => app.close())
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })

  it('the decision address checks its input', async () => {
    expect((await post(app, '/api/energy-saving/tasks/task-nope/decision', { accept: 'yes' })).statusCode).toBe(400)
    expect((await post(app, '/api/energy-saving/tasks/task-nope/decision', { accept: true })).statusCode).toBe(404)
    const id = (await chat('Create task in region REGION-A')).json().taskId as string
    expect((await post(app, `/api/energy-saving/tasks/${id}/decision`, { accept: true })).statusCode).toBe(409)
  })
  it('lists the sample regions', async () => {
    const j = (await app.inject('/api/regions')).json()
    expect(j.map((r: { name: string }) => r.name)).toEqual(['REGION-A', 'REGION-B', 'REGION-C', 'REGION-D', 'REGION-E', 'Faulty-Demo', 'Negotiate-Demo', 'Slow-Demo'])
  })
  it('one message can create a task and show the price and the plan', async () => {
    const j = (await chat('Create a task in region REGION-B, 50Mbps, and show today\'s price and plan')).json()
    expect(j.actions.map((a: { kind: string; intent: string }) => [a.kind, a.intent])).toEqual([['task', 'submit-task'], ['query', 'query-both']])
    expect(j.actions[0]).toMatchObject({ success: true, taskId: expect.stringMatching(/^task-\d{8}-\d{4}$/), params: { region: 'REGION-B' } })
    expect(j.actions[1].prices).toHaveLength(24)
    expect(j.intent).toBe('submit-task') // first action is also at the top level
  })
  it('a task in an unknown region fails inside the action, the query still runs', async () => {
    const j = (await chat('Create a task in region Atlantis and show today\'s price')).json()
    expect(j.actions[0]).toMatchObject({ kind: 'task', success: false, message: expect.stringContaining('not a known region') })
    expect(j.actions[1]).toMatchObject({ kind: 'query', intent: 'query-price' })
  })
  it('reads the task by its id and tracks it', async () => {
    const id = (await chat('Create task in region REGION-A')).json().taskId as string
    const first = (await app.inject(`/api/energy-saving/tasks/${id}`)).json()
    expect(first).toMatchObject({ taskId: id, region: 'REGION-A', state: expect.stringMatching(/sent|working/), final: false })
    expect((await app.inject('/api/energy-saving/tasks')).json().some((t: { taskId: string }) => t.taskId === id)).toBe(true)
    expect((await app.inject('/api/energy-saving/tasks/task-nope')).statusCode).toBe(404)
  })
  it('the REST submit also refuses an unknown region', async () => {
    const r = await post(app, '/api/energy-saving/task/submit', { userInput: 'Create task in region Atlantis' })
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toContain('not a known region')
  })
  it('a task sentence without a region is answered with a question, nothing is sent, the query still runs', async () => {
    const before = (await app.inject('/api/energy-saving/tasks')).json().length
    const j = (await chat('Create an energy-saving task, downlink not lower than 30Mbps, and show today\'s price')).json()
    expect(j.actions[0]).toMatchObject({ kind: 'task', success: false, params: { region: '' }, message: expect.stringMatching(/^Which region is the task for\?/) })
    expect(j.actions[0].taskId).toBeUndefined()
    expect(j.actions[1]).toMatchObject({ kind: 'query', intent: 'query-price' })
    expect((await app.inject('/api/energy-saving/tasks')).json()).toHaveLength(before)
  })
})

describe('no built-in region', () => {
  it('a new database has no region; at start the old default and demo regions go, unless a task used them; dataset regions stay', () => {
    const db = openDb(':memory:')
    initTaskTables(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM region').get()).toEqual({ n: 0 })
    const ins = db.prepare('INSERT INTO region VALUES(?,?,?,?)')
    ins.run('OLD-DEFAULT', 'the default region of an earlier version', 120, 'normal')
    ins.run('OLD-USED', 'a demo region of an earlier version', 10, 'normal')
    ins.run('DATA-REGION', 'Made with the test data "x"', 10, 'normal')
    recordTask(db, { a2aTaskId: 'a2a-1', text: 't', region: 'OLD-USED', rateMbps: fixed(50), reserveBackupRatio: 50 })
    initTaskTables(db)
    expect((db.prepare('SELECT name FROM region ORDER BY rowid').all() as { name: string }[]).map((r) => r.name)).toEqual(['OLD-USED', 'DATA-REGION'])
  })
})

describe('AI config file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  const write = (name: string, text: string) => {
    const f = join(dir, name)
    writeFileSync(f, text)
    return f
  }
  it('the shipped file loads', () => {
    const c = loadConfig()
    expect(c.timeoutMs).toBe(300000)
    expect(c.retries).toBe(1)
    expect(c.limits.reserveBackupRatio).toEqual({ min: 0, max: 100 })
    expect(c.prompt).toContain('{today}')
  })
  it('a missing or broken file gives the defaults', () => {
    expect(loadConfig(join(dir, 'nope.json')).timeoutMs).toBe(300000)
    expect(loadConfig(write('bad.json', '{ not json')).defaults).toEqual({ rateMbps: 50, reserveBackupRatio: 50 })
  })
  it('own values are used, bad ones replaced, retries capped at 3', () => {
    const c = loadConfig(write('own.json', JSON.stringify({ timeoutMs: 5000, retries: 9, limits: { rateMbps: { min: 1, max: 10 } }, prompt: 'no placeholder' })))
    expect(c.timeoutMs).toBe(5000)
    expect(c.retries).toBe(3)
    expect(c.limits.rateMbps).toEqual({ min: 1, max: 10 })
    expect(c.prompt).toContain('{today}') // a prompt without {today} is replaced
  })
})

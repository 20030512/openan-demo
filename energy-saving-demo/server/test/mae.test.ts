// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The mock Network Agent and the skill clients that call it, as the design describes them (3.2.2 steps 3 to 5, 6.10 to 6.12):
 * login, the A2A-T message with its headers and body, the Task-T text, and the error texts of design section 10.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { openDb, setConfig } from '../src/db.js'
import { createMockMae, STREAM_PATH, TASK_T_URI, TASKS_PATH, TEMPLATE_URI, TOKEN_PATH } from './support/mock-mae.js'
import { A2AClient } from '../src/skills/energy-saving/a2a-client.js'
import { readLatestStrategy } from '../src/skills/energy-saving/strategy-reader.js'
import { allDayRate, rateRanges } from '../src/intent.js'
import { buildTaskRequest, buildTaskT, fillTemplate } from '../src/skills/energy-saving/task-template-builder.js'
import { TokenClient, type MaeLogin } from '../src/skills/energy-saving/token-client.js'
import { initTaskTables } from '../src/tasks.js'
import { BASE, makeApp, post, testFixtures } from './helpers.js'

const URL0 = 'http://mae.mock'
const fresh = () => {
  const db = openDb(':memory:')
  initTaskTables(db)
  testFixtures(db)
  return db
}
const login = (mae: ReturnType<typeof createMockMae>, user = 'demo', value = 'demo123') =>
  mae(`${URL0}${TOKEN_PATH}`, { method: 'POST', body: JSON.stringify({ grantType: 'password', userName: user, value }) })
const taskT = (region = 'REGION-A', rate = 50) =>
  buildTaskT({ region, rateMbps: fixed(rate), reserveBackupRatio: 40 }, PLAN)
const fixed = (n: number) => rateRanges(allDayRate(n)) // one rate for the whole day
const PLAN = { batchId: 1, strategies: [{ strategyDate: '2026-10-24', startTime: '08:00', endTime: '12:00', stage: 'LOW' as const }] }
const message = (text: string, over: object = {}, region = 'REGION-A', rate = 50) => ({
  message: {
    messageId: 'm-1',
    contextId: 'c-1',
    role: 'ROLE_USER',
    parts: [{ text: 'Help me perform energy efficiency optimization' }],
    metadata: { [TASK_T_URI]: text, templateUri: TEMPLATE_URI },
    ...over,
  },
})
const headers = (token: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  'a2a-extensions': TASK_T_URI,
  'a2a-version': '1.0',
  ...extra,
})

const TASK_T_SAMPLE = `## Operation Type
Create
## Task Type
RAN energy saving
## Task Description
Based on the time-segment-based guaranteed throughput target in the XX region: {00:00–07:00, 2Mbps}, {07:00–17:30, 10Mbps}, {17:30–23:00, 20Mbps}, and {23:00–24:00, 2Mbps}, output a RAN energy-saving solution.
## Task Object
XX Region
## Task Target
Maximize energy saving under the condition that the task context is met.
## Task Context
Time-segment-based guaranteed throughput target: {00:00~07:00,2Mbps}, {07:00~17:30,10Mbps}, {17:30~23:00,20Mbps}, {23:00~24:00,2Mbps}
Reserve Backup Ratio: not lower than 50%
EnergySaving Strategy: {"batchId":1,"strategies":[{"strategyDate":"2026-10-24","startTime":"08:00","endTime":"12:00","stage":"LOW"}]}
## Expected Output
Requirements: If the task object is a geographical or logical region, the report of the energy saving intent is generated. The report must contain the following information:
### Basic information about the report
Region
Intent achievement
### Details about the report
Energy saving gain achievement, energy saving gain target, actual energy saving gain in percentage, and suggestions on target adjustment
Throughput rate target achievement, current rate target, actual rate, and suggestions on target adjustment`

describe('Task-T text (design 6.10)', () => {
  it('is the given template: sections, the speed segments, the reserve ratio and the strategy from the database', () => {
    const t = taskT('REGION-B', 80)
    expect(t).toContain('## Operation Type\nCreate\n## Task Type\nRAN energy saving')
    expect(t).toContain('## Task Object\nREGION-B Region')
    expect(t).toContain('{00:00~24:00,80Mbps}')
    expect(t).toContain('in the REGION-B region: {00:00–24:00, 80Mbps}, output')
    expect(t).toContain('Reserve Backup Ratio: not lower than 40%')
    expect(t).toContain('EnergySaving Strategy: {"batchId":1,"strategies":[{"strategyDate":"2026-10-24","startTime":"08:00","endTime":"12:00","stage":"LOW"}]}')
    expect(t.indexOf('Reserve Backup Ratio')).toBeLessThan(t.indexOf('EnergySaving Strategy'))
    expect(t.indexOf('EnergySaving Strategy')).toBeLessThan(t.indexOf('## Expected Output'))
    expect(t).not.toContain('Charge/Discharge Plan') // the strategy is carried once
    expect(t).toContain('## Expected Output')
  })
})

describe('strategy reader (design 6.9)', () => {
  it('reads every row of the latest batch, FLAT included', () => {
    const db = fresh()
    const ins = db.prepare('INSERT INTO charge_discharge_strategy(batch_id,strategy_date,start_time,end_time,stage) VALUES(?,?,?,?,?)')
    ins.run(1, '2026-10-23', '00:00', '24:00', 'FLAT')
    ins.run(2, '2026-10-24', '00:00', '08:00', 'LOW')
    ins.run(2, '2026-10-24', '08:00', '18:00', 'FLAT')
    expect(readLatestStrategy(db)).toEqual({
      batchId: 2,
      strategies: [
        { strategyDate: '2026-10-24', startTime: '00:00', endTime: '08:00', stage: 'LOW' },
        { strategyDate: '2026-10-24', startTime: '08:00', endTime: '18:00', stage: 'FLAT' },
      ],
    })
  })
  it('is empty when there is no strategy', () => expect(readLatestStrategy(fresh())).toEqual({ batchId: 0, strategies: [] }))
})

describe('mock MAE login (design 3.2.2 step 4)', () => {
  it('answers {expires, accessToken} for the right account', async () => {
    const r = await login(createMockMae(fresh()))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ expires: 1800, accessToken: expect.stringMatching(/^x-[0-9a-f]{48}$/) })
  })
  it.each([['wrong user', 'nobody', 'demo123'], ['wrong password', 'demo', 'nope']])('%s is 401', async (_n, u, p) => {
    expect((await login(createMockMae(fresh()), u, p)).status).toBe(401)
  })
  it('refuses another grant type', async () => {
    const r = await createMockMae(fresh())(`${URL0}${TOKEN_PATH}`, { method: 'POST', body: JSON.stringify({ grantType: 'client_credentials', userName: 'demo', value: 'demo123' }) })
    expect(r.status).toBe(401)
  })
  it('a token stops working after 1800 s', async () => {
    let clock = 1_000_000
    const mae = createMockMae(fresh(), () => clock)
    const { accessToken } = (await (await login(mae)).json()) as { accessToken: string }
    const get = () => mae(`${URL0}${TASKS_PATH}x`, { headers: headers(accessToken) })
    expect((await get()).status).toBe(404) // allowed in, but the task does not exist
    clock += 1801_000
    expect((await get()).status).toBe(401)
  })
})

describe('mock MAE task message (design 3.2.2 step 5)', () => {
  const setup = async () => {
    const db = fresh()
    const mae = createMockMae(db)
    const { accessToken } = (await (await login(mae)).json()) as { accessToken: string }
    const send = (body: unknown, h: Record<string, string> = headers(accessToken)) => mae(`${URL0}${STREAM_PATH}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    return { mae, token: accessToken, send }
  }

  it('accepts the design message and answers an event stream with the task id', async () => {
    const { send } = await setup()
    const r = await send(message(taskT('REGION-A', 50)))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/event-stream')
    expect(await r.text()).toBe('id:1\ndata:{"task":{"id":"m-1","contextId":"c-1","status":{"state":"TASK_STATE_SUBMITTED"}}}\n\n')
  })
  it('then reports WORKING and a COMPLETED task with the report fields of 3.4.2', async () => {
    let clock = 5_000_000
    const db = fresh()
    const mae = createMockMae(db, () => clock)
    const { accessToken } = (await (await login(mae)).json()) as { accessToken: string }
    await mae(`${URL0}${STREAM_PATH}`, { method: 'POST', headers: headers(accessToken), body: JSON.stringify(message(taskT('REGION-A', 60), {}, 'REGION-A', 60)) })
    const state = async () => (await (await mae(`${URL0}${TASKS_PATH}m-1`, { headers: headers(accessToken) })).json()) as { status: { state: string; final: boolean }; artifacts?: { parts: { data: unknown }[] }[] }
    expect((await state()).status).toEqual({ state: 'TASK_STATE_SUBMITTED', final: false })
    clock += 2000
    expect((await state()).status.state).toBe('TASK_STATE_WORKING')
    clock += 3000
    const done = await state()
    expect(done.status).toEqual({ state: 'TASK_STATE_COMPLETED', final: true })
    expect(done.artifacts![0].parts[0].data).toEqual({
      region: 'REGION-A',
      energySavingGain: 14.3,
      energySavingGainTarget: 10,
      actualEnergySavingPercent: 14.3,
      savedEnergyKwh: 300,
      totalSavingIncome: 100,
      totalSavingIncomePercent: 11,
      currentRateTarget: 60,
      actualRate: 62.9,
      targetAdjustmentSuggestion: 'Targets met. Keep the current configuration.',
      businessPhase: 'SOLUTION_GENERATED',
      simulation: true,
    })
  })
  it.each([
    ['no token', (t: string) => headers(t, { authorization: '' }), 401],
    ['wrong token', () => headers('x-nope'), 401],
    ['no A2A-Version header', (t: string) => ({ ...headers(t), 'a2a-version': '' }), 400],
    ['no Task-T extension header', (t: string) => ({ ...headers(t), 'a2a-extensions': '' }), 400],
  ])('refuses: %s', async (_n, h, status) => {
    const { send, token } = await setup()
    expect((await send(message(taskT()), h(token))).status).toBe(status)
  })
  it.each([
    ['no messageId', { messageId: undefined }],
    ['a role that is not ROLE_USER', { role: 'ROLE_AGENT' }],
    ['no parts', { parts: undefined }],
    ['another templateUri', { metadata: { [TASK_T_URI]: taskT(), templateUri: 'other' } }],
    ['no Task-T text', { metadata: { templateUri: TEMPLATE_URI } }],
  ])('refuses a message with %s', async (_n, over) => {
    const { send } = await setup()
    expect((await send(message(taskT(), over))).status).toBe(400)
  })
  it('refuses a region it does not know and lists the known ones', async () => {
    const { send } = await setup()
    const r = await send(message(taskT('Atlantis'), {}, 'Atlantis'))
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/"Atlantis" is not a known region. Known regions: REGION-A, REGION-B/)
  })
  it('says 404 for an unknown task and for an unknown address', async () => {
    const { mae, token } = await setup()
    expect((await mae(`${URL0}${TASKS_PATH}nope`, { headers: headers(token) })).status).toBe(404)
    expect((await mae(`${URL0}/somewhere`, { headers: headers(token) })).status).toBe(404)
  })
})

describe('token client (design 6.11) and the error texts of design 10', () => {
  const setup = (login?: () => MaeLogin | null) => {
    const db = fresh()
    let calls = 0
    const mae = createMockMae(db)
    const counting: typeof mae = (u, i) => {
      if (u.endsWith(TOKEN_PATH)) calls++
      return mae(u, i)
    }
    return { db, tokens: new TokenClient(counting, URL0, undefined, login), calls: () => calls }
  }

  it('logs in with the username and password of the settings and keeps the token', async () => {
    const { tokens, calls } = setup()
    const a = await tokens.getAccessToken()
    expect(a).toMatch(/^x-/)
    expect(await tokens.getAccessToken()).toBe(a)
    expect(calls()).toBe(1)
    expect(await tokens.getAccessToken(true)).not.toBe(a) // a forced refresh logs in again
    expect(calls()).toBe(2)
  })
  it('a password that contains a colon is kept whole', async () => {
    const { tokens } = setup(() => ({ user: 'demo', password: 'pa:ss' }))
    process.env.MOCK_MAE_PASSWORD = 'pa:ss'
    try {
      await expect(tokens.getAccessToken()).resolves.toMatch(/^x-/)
    } finally {
      delete process.env.MOCK_MAE_PASSWORD
    }
  })
  it('missing authentication: "not configured"', async () => {
    const { tokens } = setup(() => null)
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ status: 503, message: 'Authentication information is not configured, please contact the administrator' })
  })
  it('the login is not kept in the database; a login stored by an earlier version is removed at start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mae-login-'))
    const dbPath = join(dir, 'energy.db')
    const create = process.env.DB_CREATE
    process.env.DB_CREATE = 'true'
    const before = openDb(dbPath)
    setConfig(before, 'authentication', Buffer.from('demo:demo123').toString('base64'))
    before.close()
    const app = await buildApp({ dbPath })
    await app.close()
    const after = openDb(dbPath)
    const rows = after.prepare('SELECT config_key, config_value FROM system_config').all() as { config_key: string; config_value: string }[]
    after.close()
    rmSync(dir, { recursive: true, force: true })
    if (create === undefined) delete process.env.DB_CREATE
    else process.env.DB_CREATE = create
    expect(rows.map((r) => r.config_key)).not.toContain('authentication')
    const values = rows.map((r) => r.config_value).join(' ')
    expect(values).not.toContain(Buffer.from('demo:demo123').toString('base64'))
    expect(values).not.toContain('demo123')
  })
  it('a login the Network Agent refuses: "authentication failed"', async () => {
    const { tokens } = setup(() => ({ user: 'demo', password: 'wrong' }))
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ status: 502, message: 'Authentication failed, please check the username and password or the network connection' })
  })
  it('a login that cannot be reached: "authentication failed"', async () => {
    const tokens = new TokenClient(() => Promise.reject(new Error('down')), URL0)
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ status: 502 })
  })
})

const REQUEST = buildTaskRequest({ region: 'REGION-A', rateMbps: fixed(50), reserveBackupRatio: 40 }, PLAN)

describe('A2A client (design 6.12)', () => {
  it('sends the Bearer token, the Task-T and version headers and the design body', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const a2a = new A2AClient(async (url, init) => {
      seen.push({ url, init: init! })
      return new Response('id:1\ndata:{"task":{"id":"srv-9","status":{"state":"TASK_STATE_SUBMITTED"}}}\n\n', { status: 200 })
    }, URL0)
    expect(await a2a.send(REQUEST, 'tok')).toBe('srv-9') // the id the Network Agent gave
    const { url, init } = seen[0]
    const h = new Headers(init.headers)
    expect(url).toBe(`${URL0}${STREAM_PATH}`)
    expect([h.get('authorization'), h.get('a2a-extensions'), h.get('a2a-version'), h.get('content-type')]).toEqual(['Bearer tok', TASK_T_URI, '1.0', 'application/json'])
    const body = JSON.parse(init.body as string).message
    expect(body).toMatchObject({ role: 'ROLE_USER', parts: [{ text: 'Help me perform energy efficiency optimization' }], metadata: { [TASK_T_URI]: REQUEST.text, templateUri: TEMPLATE_URI } })
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.contextId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.messageId).not.toBe(body.contextId)
  })
  it('uses the message id when the answer has no task frame', async () => {
    const a2a = new A2AClient(async () => new Response('', { status: 200 }), URL0)
    expect(await a2a.send(REQUEST, 'tok')).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('a refusal is "dispatch failed" with the reason; an unreachable agent too', async () => {
    const refusing = new A2AClient(async () => new Response(JSON.stringify({ error: { message: 'bad region' } }), { status: 400 }), URL0)
    await expect(refusing.send(REQUEST, 'tok')).rejects.toMatchObject({ status: 400, message: 'Energy-saving task dispatch failed: bad region' })
    const broken = new A2AClient(async () => new Response('x', { status: 500 }), URL0)
    await expect(broken.send(REQUEST, 'tok')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Energy-saving task dispatch failed') })
    const down = new A2AClient(() => Promise.reject(new Error('down')), URL0)
    await expect(down.send(REQUEST, 'tok')).rejects.toMatchObject({ status: 502, message: 'Energy-saving task dispatch failed' })
  })
})

describe('the design error texts over HTTP', () => {
  it('submit without a strategy answers the design text with 409; a broken login with 502', async () => {
    const app = await makeApp()
    const r = await post(app, '/api/energy-saving/task/submit', { userInput: 'Create task in region REGION-A' })
    expect(r.statusCode).toBe(409)
    expect(r.json().detail).toBe('The charge/discharge strategy has not been generated, please import electricity price data first')
    await app.close()
  })
  it('BASE price table sanity (helper stays usable)', () => expect(BASE).toHaveLength(24))
})

describe('the template, the parameters and the strategy are combined (design 3.2.2 step 3 and 5)', () => {
  const setup = async () => {
    const mae = createMockMae(fresh())
    const { accessToken } = (await (await login(mae)).json()) as { accessToken: string }
    return { send: (body: unknown) => mae(`${URL0}${STREAM_PATH}`, { method: 'POST', headers: headers(accessToken), body: JSON.stringify(body) }) }
  }
  const params = { region: 'REGION-A', rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], reserveBackupRatio: 40 }

  it('fills every placeholder of the template, with the segments of the sentence', () => {
    const t = buildTaskT(params, PLAN)
    expect(t).not.toMatch(/\{\{/)
    expect(t).toContain('in the REGION-A region: {00:00–06:00, 2Mbps}, and {06:00–24:00, 50Mbps}, output')
    expect(t).toContain('## Task Object\nREGION-A Region')
    expect(t).toContain('Time-segment-based guaranteed throughput target: {00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}')
  })
  it('is the given Task-T text, filled in', () => {
    const four = { region: 'XX', rateMbps: [{ timeRange: '00:00~07:00', target: '2Mbps' }, { timeRange: '07:00~17:30', target: '10Mbps' }, { timeRange: '17:30~23:00', target: '20Mbps' }, { timeRange: '23:00~24:00', target: '2Mbps' }], reserveBackupRatio: 50 }
    expect(buildTaskT(four, PLAN)).toBe(TASK_T_SAMPLE)
  })
  it('a placeholder without a value, or a value without a placeholder, is refused', () => {
    expect(() => fillTemplate('a {{x}} b {{y}}', { x: '1' })).toThrow('no value for {{y}}')
    expect(() => fillTemplate('a {{x}}', { x: '1', z: '2' })).toThrow('no placeholder for z')
  })
  it('the text carries the parameters and the strategy', () => {
    const r = buildTaskRequest(params, PLAN)
    expect(r).toEqual({ text: buildTaskT(params, PLAN) })
    expect(r.text).toContain(`EnergySaving Strategy: ${JSON.stringify(PLAN)}`)
    expect(r.text).toContain('Reserve Backup Ratio: not lower than 40%')
  })
  it('without segments from the sentence the target is one range for the whole day', () => {
    expect(buildTaskRequest({ region: 'A', rateMbps: fixed(80), reserveBackupRatio: 30 }, PLAN).text).toContain('{00:00~24:00,80Mbps}')
  })

  it('the request metadata is only the Task-T text and templateUri (design 3.2.2 step 5)', async () => {
    const seen: { init: RequestInit }[] = []
    const a2a = new A2AClient(async (_u, init) => {
      seen.push({ init: init! })
      return new Response('id:1\ndata:{"task":{"id":"x","status":{"state":"TASK_STATE_SUBMITTED"}}}\n\n', { status: 200 })
    }, URL0)
    await a2a.send(buildTaskRequest(params, PLAN), 'tok')
    const meta = JSON.parse(seen[0].init.body as string).message.metadata
    expect(Object.keys(meta).sort()).toEqual([TASK_T_URI, 'templateUri'].sort())
  })

  it.each([
    ['no reserve ratio line', (t: string) => t.replace(/^Reserve Backup Ratio:.*\n/m, ''), /Reserve Backup Ratio/],
    ['no strategy line', (t: string) => t.replace(/^EnergySaving Strategy:.*\n/m, ''), /EnergySaving Strategy/],
  ])('the Network Agent refuses a Task-T text with %s', async (_n, cut, why) => {
    const { send } = await setup()
    const r = await send(message(cut(taskT())))
    expect(r.status).toBe(400)
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(why)
  })
})

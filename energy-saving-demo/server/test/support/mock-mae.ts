// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * A stand-in for the Network Agent, FOR THE TESTS ONLY (it is not part of the package). It answers the requests the design describes,
 * with the answers the design gives:
 *  - POST /api/rest/securityManagement/v1/oauth/token  {grantType, userName, value} -> {expires, accessToken}
 *  - POST /a2a/json/message:stream  the A2A-T request body: the populated Task-T text and templateUri in metadata
 *  - GET  /a2a/tasks/{id}           the state of a task and, when finished, the report of the Task-T "Expected Output"
 * The task states are A2A task states. Test regions change what happens: `Faulty-Demo` fails halfway, `Slow-Demo` never finishes,
 * `Negotiate-Demo` stops at INPUT_REQUIRED with a proposal until the user accepts or rejects it (POST /a2a/tasks/{id}/decision).
 * It works as a `fetch`, so a test hands it to the app (buildApp option maeFetch); the same behaviour as a small HTTP server is in
 * test-tools/mock-mae.mjs.
 */
import { randomBytes } from 'node:crypto'
import type { Db } from '../../src/db.js'
import { STREAM_PATH, TASK_T_URI, TASKS_PATH, TEMPLATE_URI, TOKEN_PATH, type MaeFetch } from '../../src/mae/protocol.js'

export { STREAM_PATH, TASK_T_URI, TASKS_PATH, TEMPLATE_URI, TOKEN_PATH, type MaeFetch }

interface MockTask {
  id: string
  contextId: string
  region: string
  rateMbps: number
  behaviour: string
  createdAt: number
  decision?: { accept: boolean; at: number }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (status: number, message: string) => json(status, { error: { code: status, message } })

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** The account the mock accepts (the tests give the server the same login in MAE_USERNAME and MAE_PASSWORD). */
const accounts = () => [{ user: process.env.MOCK_MAE_USER ?? 'demo', password: process.env.MOCK_MAE_PASSWORD ?? 'demo123' }]

export function createMockMae(db: Db, now: () => number = Date.now): MaeFetch {
  const tokens = new Map<string, number>()
  const tasks = new Map<string, MockTask>()

  const bearerOk = (h: Headers) => {
    const m = /^Bearer (.+)$/.exec(h.get('authorization') ?? '')
    const exp = m ? tokens.get(m[1]) : undefined
    return exp !== undefined && exp > now()
  }

  function parseTaskT(text: string) {
    const region = /## Task Object\s*\n\s*(.+?) Region\s*\n/.exec(text)?.[1]?.trim()
    const line = /Time-segment-based guaranteed throughput target:([^\n]*)/.exec(text)?.[1] ?? ''
    const rates = [...line.matchAll(/(\d+(?:\.\d+)?)Mbps/g)].map((m) => Number(m[1]))
    return { region, rateMbps: rates.length ? Math.max(...rates) : 0 }
  }

  /** The proposal of the Network Agent: lower targets than asked. Lowering them is high risk and never accepted automatically. */
  const proposal = (t: MockTask) => ({
    type: 'Negotiation-T',
    savingTarget: { from: 10, to: 8, unit: '%' },
    speedGuarantee: { from: t.rateMbps, to: Math.max(2, Math.round(t.rateMbps / 2)), unit: 'Mbps' },
    risk: 'HIGH',
    summary: 'The requested targets cannot both be met. Lower the saving target and the speed guarantee?',
  })

  function taskState(t: MockTask): { state: string; final: boolean; text?: string; data?: object } {
    const sim = num('TASK_SIM_MS', 5000)
    const f = (now() - t.createdAt) / sim
    if (t.behaviour === 'negotiate') {
      if (!t.decision) {
        if (f >= 0.4) return { state: 'TASK_STATE_INPUT_REQUIRED', final: false, data: proposal(t) }
        return { state: f >= 0.2 ? 'TASK_STATE_WORKING' : 'TASK_STATE_SUBMITTED', final: false }
      }
      if (!t.decision.accept) return { state: 'TASK_STATE_FAILED', final: true, text: 'The proposal was rejected by the user' }
      return (now() - t.decision.at) / sim >= 0.4 ? { state: 'TASK_STATE_COMPLETED', final: true } : { state: 'TASK_STATE_WORKING', final: false }
    }
    if (t.behaviour === 'hang') return { state: 'TASK_STATE_WORKING', final: false }
    if (t.behaviour === 'fail' && f >= 0.4) return { state: 'TASK_STATE_FAILED', final: true, text: 'The network agent rejected the task (test region)' }
    if (f >= 1) return { state: 'TASK_STATE_COMPLETED', final: true }
    return { state: f >= 0.2 ? 'TASK_STATE_WORKING' : 'TASK_STATE_SUBMITTED', final: false }
  }

  /** The Task-T "Expected Output": basic information and details of the intent report (3.4.2 fields). */
  const report = (t: MockTask) => ({
    region: t.region,
    energySavingGain: 14.3,
    energySavingGainTarget: 10,
    actualEnergySavingPercent: 14.3,
    savedEnergyKwh: 300,
    totalSavingIncome: 100,
    totalSavingIncomePercent: 11,
    currentRateTarget: t.rateMbps,
    actualRate: Math.round(t.rateMbps * 1.048 * 10) / 10,
    targetAdjustmentSuggestion: 'Targets met. Keep the current configuration.',
    businessPhase: 'SOLUTION_GENERATED',
    simulation: true,
  })

  return async (url, init = {}) => {
    const { pathname } = new URL(url, 'http://mae.mock')
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    let body: Record<string, unknown> = {}
    if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        return fail(400, 'body is not JSON')
      }
    }

    if (method === 'POST' && pathname === TOKEN_PATH) {
      if (body.grantType !== 'password' || !accounts().some((a) => a.user === body.userName && a.password === body.value)) return fail(401, 'wrong user name or password')
      const accessToken = `x-${randomBytes(24).toString('hex')}`
      tokens.set(accessToken, now() + 1800_000)
      return json(200, { expires: 1800, accessToken })
    }

    if (method === 'POST' && pathname === STREAM_PATH) {
      if (!bearerOk(headers)) return fail(401, 'missing or expired access token')
      if (headers.get('a2a-version') !== '1.0') return fail(400, 'missing A2A-Version header')
      if (!(headers.get('a2a-extensions') ?? '').includes(TASK_T_URI)) return fail(400, 'missing A2A-Extensions header for Task-T')
      const m = body.message as { messageId?: unknown; contextId?: unknown; role?: unknown; parts?: unknown; metadata?: Record<string, unknown> } | undefined
      const text = m?.metadata?.[TASK_T_URI]
      if (!m || typeof m.messageId !== 'string' || typeof m.contextId !== 'string' || m.role !== 'ROLE_USER' || !Array.isArray(m.parts) || typeof text !== 'string') {
        return fail(400, 'message needs messageId, contextId, role ROLE_USER, parts and the Task-T text in metadata')
      }
      if (m.metadata?.templateUri !== TEMPLATE_URI) return fail(400, `templateUri must be ${TEMPLATE_URI}`)
      const { region, rateMbps } = parseTaskT(text)
      if (!region) return fail(400, 'Task Object is missing in the Task-T text')
      // The Task Context carries the reserve ratio and the strategy read from the database (design 3.2.2 step 3).
      if (!/^Reserve Backup Ratio: not lower than \d+(\.\d+)?%$/m.test(text)) return fail(400, 'Task Context needs the line "Reserve Backup Ratio: not lower than N%"')
      if (!/^EnergySaving Strategy: \{.*"strategies":\[/m.test(text)) return fail(400, 'Task Context needs the line "EnergySaving Strategy:" with the charge/discharge strategy')
      const known = db.prepare('SELECT name, behaviour FROM region WHERE name=?').get(region) as { name: string; behaviour: string } | undefined
      if (!known) {
        const names = (db.prepare('SELECT name FROM region ORDER BY rowid').all() as { name: string }[]).map((r) => r.name).join(', ')
        return fail(400, `Task Object "${region}" is not a known region. Known regions: ${names}`)
      }
      const t: MockTask = { id: m.messageId, contextId: m.contextId, region: known.name, rateMbps, behaviour: known.behaviour, createdAt: now() }
      tasks.set(t.id, t)
      const frame = { task: { id: t.id, contextId: t.contextId, status: { state: 'TASK_STATE_SUBMITTED' } } }
      return new Response(`id:1\ndata:${JSON.stringify(frame)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }

    const dec = method === 'POST' && pathname.startsWith(TASKS_PATH) && pathname.endsWith('/decision') ? decodeURIComponent(pathname.slice(TASKS_PATH.length, -'/decision'.length)) : undefined
    if (dec !== undefined) {
      if (!bearerOk(headers)) return fail(401, 'missing or expired access token')
      const t = tasks.get(dec)
      if (!t) return fail(404, 'task not found')
      if (taskState(t).state !== 'TASK_STATE_INPUT_REQUIRED') return fail(409, 'the task is not waiting for an answer')
      if (typeof body.accept !== 'boolean') return fail(400, 'accept must be true or false')
      t.decision = { accept: body.accept, at: now() }
      return json(200, { id: t.id, status: { state: body.accept ? 'TASK_STATE_WORKING' : 'TASK_STATE_FAILED' } })
    }

    const get = method === 'GET' && pathname.startsWith(TASKS_PATH) ? decodeURIComponent(pathname.slice(TASKS_PATH.length)) : undefined
    if (get !== undefined) {
      if (!bearerOk(headers)) return fail(401, 'missing or expired access token')
      const t = tasks.get(get)
      if (!t) return fail(404, 'task not found')
      const s = taskState(t)
      return json(200, {
        id: t.id,
        contextId: t.contextId,
        status: { state: s.state, final: s.final, ...(s.text ? { message: { parts: [{ text: s.text }] } } : {}), ...(s.data ? { message: { parts: [{ data: s.data }] } } : {}) },
        ...(s.state === 'TASK_STATE_COMPLETED' ? { artifacts: [{ parts: [{ data: report(t) }] }] } : {}),
      })
    }

    return fail(404, `no such mock MAE address: ${method} ${pathname}`)
  }
}

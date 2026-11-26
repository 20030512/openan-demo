// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { STREAM_PATH, TASK_T_URI, TASKS_PATH, TEMPLATE_URI, type MaeFetch } from '../../mae/protocol.js'
import { causeAndAction, clip, explainConnection, explainMaeStatus, headersText, maeDetail, maeTimeout, maskToken, message, since, type TraceLog } from '../../trace.js'
import { SkillError, TokenRefusedError } from './errors.js'

const refusedToken = (status: number) => status === 401 || status === 403
import type { TaskRequest } from './task-template-builder.js'

/** What the Network Agent says about a task: an A2A task state and, when finished, the artifacts with the report. */
export interface RemoteTask {
  id: string
  status: { state: string; final?: boolean; message?: { parts?: { text?: string; data?: Record<string, unknown> }[] } }
  artifacts?: { parts?: { data?: Record<string, unknown> }[] }[]
}

/** The state without its prefix: TASK_STATE_WORKING -> WORKING. */
const shortState = (s: string) => s.replace(/^TASK_STATE_/, '')

/**
 * POST the A2A-T message to the message:stream address with the Bearer token and the
 * Task-T extension headers. The task id is the message id the skill made; the first frame of the answer
 * confirms it. State and report are read afterwards by id.
 *
 * The log (see trace.ts) gets one record for the request and one for the response or the failure: sending a task, a change of the
 * state of a task, the answer to a proposal. The state is asked about every second or so, so only a change is written. LOG_LEVEL=debug
 * adds the request in full (headers with the token cut, and the whole Task-T text).
 */
export class A2AClient {
  private lastState = new Map<string, string>()

  constructor(
    private maeFetch: MaeFetch,
    private baseUrl: string,
    /** When given, the requests sent to MAE and its answers are written to the log. */
    private log?: TraceLog,
  ) {}

  async send(request: TaskRequest, accessToken: string): Promise<string> {
    const messageId = randomUUID()
    const body = {
      message: {
        messageId,
        contextId: randomUUID(),
        role: 'ROLE_USER',
        parts: [{ text: 'Help me perform energy efficiency optimization' }],
        // The populated Task-T text under the Task-T extension key, and the template it was made from.
        metadata: {
          [TASK_T_URI]: request.text,
          templateUri: TEMPLATE_URI,
        },
      },
    }
    const url = `${this.baseUrl}${STREAM_PATH}`
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'a2a-extensions': TASK_T_URI,
      'a2a-version': '1.0',
    }
    const t0 = Date.now()
    const o = { logger: 'mae.client' }
    this.log?.info(o, message('MAE task request', { operation: 'send_task', method: 'POST', url, token: maskToken(accessToken), task_t_chars: request.text.length }, { headers: JSON.stringify({ ...headers, authorization: `Bearer ${maskToken(accessToken)}` }), body: JSON.stringify(body, null, 2) }))
    let res: Response
    try {
      res = await this.maeFetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    } catch (e) {
      const c = explainConnection(e, this.baseUrl, maeTimeout())
      this.log?.error(o, message('MAE task request failed', { operation: 'send_task', url, duration_ms: since(t0) }, { summary: c.what, cause: c.meaning, action: 'check MAE_BASE_URL, then test: ./start.sh check-mae' }))
      throw new SkillError(502, 'Energy-saving task dispatch failed')
    }
    // TODO: read the stream event by event instead of the whole text, then take the task id from the first event
    const answer = await res.text()
    if (!res.ok) {
      const why = maeDetail(answer)
      const w = explainMaeStatus(res.status, 'task', url, why)
      this.log?.error(o, message('MAE task request failed', { operation: 'send_task', url, status: res.status, duration_ms: since(t0) }, { summary: w.what, mae_says: why, response_headers: headersText(res.headers), body: clip(answer.trim(), 2000), ...causeAndAction(w) }))
      const text = `Energy-saving task dispatch failed: ${why || `HTTP ${res.status}`}`
      if (refusedToken(res.status)) throw new TokenRefusedError(502, text)
      throw new SkillError(res.status === 400 ? 400 : 502, text)
    }
    const first = /data:(\{.*\})/.exec(answer)
    const id = (first ? (JSON.parse(first[1]) as { task?: { id?: string } }).task?.id : undefined) ?? messageId
    this.log?.info(o, message('MAE task response', { operation: 'send_task', status: res.status, duration_ms: since(t0), task_id: id }, { response_headers: headersText(res.headers), body: clip(answer.trim(), 8000) }))
    return id
  }

  /** Answer a proposal (INPUT_REQUIRED): the user accepts or rejects it, the agent never decides this alone. */
  async decide(id: string, accept: boolean, accessToken: string): Promise<void> {
    const url = `${this.baseUrl}${TASKS_PATH}${encodeURIComponent(id)}/decision`
    const t0 = Date.now()
    const o = { logger: 'mae.client' }
    this.log?.info(o, message('MAE proposal answer request', { operation: 'decision', method: 'POST', url, task_id: id, answer: accept ? 'accept' : 'reject', decided_by: 'the user' }, { headers: JSON.stringify({ 'content-type': 'application/json', authorization: `Bearer ${maskToken(accessToken)}`, 'a2a-version': '1.0' }), body: JSON.stringify({ accept }) }))
    const res = await this.maeFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}`, 'a2a-version': '1.0' },
      body: JSON.stringify({ accept }),
    })
    const answer = await res.text().catch(() => '')
    if (!res.ok) {
      const why = detail(res, answer)
      const w = explainMaeStatus(res.status, 'task', url, why)
      this.log?.error(o, message('MAE proposal answer failed', { operation: 'decision', url, task_id: id, status: res.status, duration_ms: since(t0) }, { summary: w.what, response_headers: headersText(res.headers), body: clip(answer.trim(), 2000), ...causeAndAction(w) }))
      if (refusedToken(res.status)) throw new TokenRefusedError(502, `Answering the proposal failed: ${why}`)
      throw new SkillError(res.status === 409 ? 409 : 502, `Answering the proposal failed: ${why}`)
    }
    this.log?.info(o, message('MAE proposal answer response', { operation: 'decision', status: res.status, duration_ms: since(t0), task_id: id }, { response_headers: headersText(res.headers), body: clip(answer.trim(), 4000) || '(empty)' }))
  }

  async getTask(id: string, accessToken: string): Promise<RemoteTask> {
    const url = `${this.baseUrl}${TASKS_PATH}${encodeURIComponent(id)}`
    const t0 = Date.now()
    const o = { logger: 'mae.client' }
    const reqHeaders = { authorization: `Bearer ${accessToken}`, 'a2a-version': '1.0' }
    const first = !this.lastState.has(id)
    if (first) this.log?.info(o, message('MAE task state request', { operation: 'get_task', method: 'GET', url, task_id: id, note: 'repeated about every second; only changes are written at info, every answer at debug' }, { headers: JSON.stringify({ ...reqHeaders, authorization: `Bearer ${maskToken(accessToken)}` }) }))
    const res = await this.maeFetch(url, { headers: reqHeaders })
    const answer = await res.text().catch(() => '')
    this.log?.debug?.(o, message('MAE task state poll', { task_id: id, status: res.status, duration_ms: since(t0) }, { body: clip(answer.trim(), 4000) }))
    if (!res.ok) {
      const why = detail(res, answer)
      const w = explainMaeStatus(res.status, 'task state', url, why)
      this.log?.error(o, message('MAE task state request failed', { operation: 'get_task', url, task_id: id, status: res.status, duration_ms: since(t0) }, { summary: w.what, response_headers: headersText(res.headers), body: clip(answer.trim(), 2000), ...causeAndAction(w) }))
      if (refusedToken(res.status)) throw new TokenRefusedError(res.status, `Reading the task failed: ${why}`)
      throw new SkillError(res.status, `Reading the task failed: ${why}`)
    }
    const task = JSON.parse(answer) as RemoteTask
    const state = shortState(task.status.state)
    const before = this.lastState.get(id)
    if (before !== state) {
      this.lastState.set(id, state)
      this.log?.info(o, message('MAE task state', { task_id: id, previous: before ?? 'none', state }, { ...stateTexts(task), response_headers: headersText(res.headers), body: clip(answer.trim(), 4000) }))
    }
    return task
  }
}

/** What is worth showing when a task changes its state: the report, the proposal or the reason of a failure. */
function stateTexts(t: RemoteTask): Record<string, string> {
  const part = t.status.message?.parts?.[0]
  if (t.status.state === 'TASK_STATE_COMPLETED') {
    const r = t.artifacts?.[0]?.parts?.[0]?.data as Record<string, unknown> | undefined
    if (!r) return { result: 'completed without a report' }
    return {
      report: `energy saving ${r.actualEnergySavingPercent} % (target ${r.energySavingGainTarget} %), saved ${r.savedEnergyKwh} kWh, rate ${r.actualRate} Mbps (target ${r.currentRateTarget}), simulation ${r.simulation}`,
    }
  }
  if (t.status.state === 'TASK_STATE_INPUT_REQUIRED') return { proposal: clip(JSON.stringify(part?.data ?? {}), 300), next: 'waits for the answer of the user (accept or reject)' }
  if (/FAILED|CANCELED|REJECTED/.test(t.status.state)) return { reason: part?.text ?? 'the Network Agent gave no reason' }
  return {}
}

function detail(res: Response, text: string): string {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`
  }
}

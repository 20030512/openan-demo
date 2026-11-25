// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Energy-saving dashboard API (design doc sections 3.3, 3.4 and 5).
 *
 * The three dashboard endpoints return fixed demo data, as the design specifies. The recommended-question
 * query reads the real price and strategy tables that the charge/discharge module fills.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db.js'
import { body, HttpError } from '../http.js'
import type { Intent, TaskParams } from '../intent.js'
import { extractParamsWithLlm, readSettings, routeWithLlm, type LlmOutcome, type LlmSettings } from '../llm.js'
import { clip, message as record, ratesText } from '../trace.js'
import { dayQuery, queryDay as queryDayIn } from '../day-query.js'
import { QueryDateError } from '../query-date.js'
import { SkillError, type Skill } from '../skills/energy-saving/index.js'
import { answerProposal, listRegions, readTask, recentTasks, recordTask } from '../tasks.js'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** The answer to a task sentence without a region (the dashboard shows it in the user's language). */
export const NO_REGION = 'Which region is the task for? The sentence names no region, so no task was sent. Write the region in the sentence, for example: Create an energy-saving task in region X, downlink not lower than 30Mbps.'

export function energySavingRoutes(app: FastifyInstance, db: Db, doFetch: typeof fetch, skill: Skill) {
  /** Steps 2 to 5 of the skill, then the task is recorded under its own number. A failed step keeps the design's text. */
  async function submit(text: string, params: TaskParams) {
    // There is no default region: a sentence without one is answered with a question, and nothing is sent to the Network Agent.
    if (!params.region) {
      const known = listRegions(db).map((r) => r.name)
      app.log.warn({ logger: 'task' }, record('Task not sent', { reason: 'no region' }, { cause: 'The sentence names no region, and there is no default region.', action: 'the user writes the region in the sentence' }))
      throw new SkillError(400, `${NO_REGION}${known.length ? ` Known regions: ${known.join(', ')}.` : ''}`)
    }
    const a2aTaskId = await skill.submitTask(params)
    return recordTask(db, { a2aTaskId, text, ...params })
  }

  /**
   * The LLM reads every sentence (intent, day, parameters). There is no other reader: when it is not configured, or gives no usable
   * answer, the request fails with the reason in words, and the log has the same reason as an ERROR record.
   */
  const llmSettings = (): LlmSettings => {
    const s = readSettings(db)
    if (!s.enabled || !s.apiKey) {
      const cause = !s.apiKey ? 'LLM_API_KEY is empty.' : 'LLM_ENABLED is not true.'
      const action = './start.sh LLM_PROVIDER=<provider> LLM_MODEL=<model> LLM_API_KEY=<key>   then test: ./start.sh check-llm'
      app.log.error({ logger: 'chat' }, record('Request rejected', { reason: 'the LLM is not configured' }, { cause, action }))
      throw new HttpError(503, `The LLM is not configured: ${cause} Fix: ${action}`)
    }
    return s
  }
  const paramsFromLlm = async (s: LlmSettings, text: string, note: LlmOutcome): Promise<TaskParams> => {
    const p = await extractParamsWithLlm(s, text, doFetch, app.log, note)
    if (!p) {
      app.log.error({ logger: 'chat' }, record('Request rejected', { reason: 'the LLM gave no usable task parameters' }, { cause: note.error }))
      throw new HttpError(502, note.error ?? 'The LLM gave no usable task parameters')
    }
    app.log.info({ logger: 'chat' }, record('Task parameters resolved', { region: p.region || 'none', reserve_percent: p.reserveBackupRatio }, { rate: ratesText(p.rateMbps) }))
    return p
  }

  app.get('/api/energy-saving/dashboard/energy-summary', async () => ({
    currentConsumption: 300,
    totalEnergySavingGain: 14.3,
    metrics: [
      { label: 'Region total', value: 2810, unit: 'kWh', trend: 'down' },
      { label: 'Region daily avg.', value: 390, unit: 'kWh', trend: 'down' },
      { label: 'Per-site daily avg.', value: 18, unit: 'kWh', trend: 'up' },
    ],
    gainDistribution: {
      totalSaving: 770.58,
      unit: 'kWh',
      // the gain per radio access technology: energy saved in kWh and its share in percent (a saving is positive)
      modes: [
        { name: 'NR', value: 8245.67, percent: 80.8 },
        { name: 'LTE', value: 1956.08, percent: 19.22 },
      ],
    },
  }))

  app.get('/api/energy-saving/dashboard/kpi', async () => ({
    suggestionCards: [
      { label: 'Total', executed: 15000, total: 13000 },
      { label: 'NR', executed: 12500, total: 10000 },
      { label: 'LTE', executed: 2500, total: 3000 },
    ],
    trendChart: {
      xAxis: Array.from({ length: 14 }, (_, i) => `05-${pad(i + 1)}`),
      series: [
        { name: 'Suggestion', data: [1200, 1800, 2500, 3000, 2800, 3500, 4000, 3200, 2800, 2200, 1800, 1500, 1200, 1000] },
        { name: 'Execution', data: [1000, 1500, 2200, 2800, 2500, 3000, 3500, 2800, 2500, 2000, 1500, 1200, 1000, 800] },
        { name: 'Difference', data: [200, 300, 300, 200, 300, 500, 500, 400, 300, 200, 300, 300, 200, 200] },
      ],
    },
  }))

  app.get('/api/energy-saving/dashboard/energy-curves', async () => ({
    energyTrend: {
      xAxis: Array.from({ length: 7 }, (_, i) => `05-${12 + i}`),
      series: [
        { name: 'Total energy consumption', data: [250, 265, 240, 280, 270, 260, 255] },
        { name: '5G energy consumption', data: [150, 160, 145, 170, 165, 155, 150] },
        { name: '4G energy consumption', data: [100, 105, 95, 110, 105, 105, 105] },
      ],
    },
    priceDischarge: {
      date: '20261022',
      xAxis: Array.from({ length: 12 }, (_, i) => `${i * 2}:00`),
      price: [0.35, 0.3, 0.3, 0.4, 0.65, 0.85, 0.9, 0.85, 0.7, 0.95, 0.8, 0.5],
      discharge: [0, 0, 0, 5, 15, 25, 30, 25, 15, 35, 20, 5],
    },
  }))

  /** Sample regions kept in the database; a task must name one of them. */
  app.get('/api/regions', async () => listRegions(db))

  /** Design doc 3.4.1: submit by text. The answer carries the task id, the outcome is read later by that id. */
  app.post('/api/energy-saving/task/submit', async (req) => {
    const { userInput } = body(req)
    if (typeof userInput !== 'string' || !userInput.trim() || userInput.length > 4000) {
      throw new HttpError(400, 'userInput must be 1 to 4000 characters')
    }
    const params = await paramsFromLlm(llmSettings(), userInput, {})
    try {
      return { success: true, taskId: await submit(userInput, params), message: 'Energy-saving task submitted successfully' }
    } catch (e) {
      if (e instanceof SkillError) throw new HttpError(e.status, e.message)
      throw e
    }
  })

  /** The real state of tasks: sent, working with a progress, then completed, failed or timed out. */
  app.get('/api/energy-saving/tasks', async () => recentTasks(db, skill))
  app.get<{ Params: { id: string } }>('/api/energy-saving/tasks/:id', async (req) => {
    const t = await readTask(db, req.params.id, skill)
    if (!t) throw new HttpError(404, 'task not found')
    return t
  })

  /** The user answers a proposal of the Network Agent (task state input_required). It is never accepted automatically. */
  app.post<{ Params: { id: string } }>('/api/energy-saving/tasks/:id/decision', async (req) => {
    const { accept } = body(req)
    if (typeof accept !== 'boolean') throw new HttpError(400, 'accept must be true or false')
    try {
      const t = await answerProposal(db, req.params.id, accept, skill)
      if (!t) throw new HttpError(404, 'task not found')
      return t
    } catch (e) {
      if (e instanceof SkillError) throw new HttpError(e.status, e.message)
      throw e
    }
  })

  /** Design doc 3.4.2: the energy-saving effect report of a finished task. */
  app.get<{ Querystring: { region?: string; taskId?: string } }>('/api/energy-saving/effect', async (req) => {
    const { region, taskId } = req.query
    if (!region || !taskId) throw new HttpError(400, 'region and taskId are required')
    const t = await readTask(db, taskId, skill)
    if (!t) throw new HttpError(404, 'task not found')
    if (t.state !== 'completed' || !t.report) throw new HttpError(409, `task is ${t.state}, the effect report is not ready`)
    const { businessPhase: _p, simulation: _s, ...effect } = t.report
    return effect
  })

  /** Skill features 2 and 3 (design doc 3.2.3, 3.2.4): rows of the newest batch that holds the day, from the database. */
  const queryDay = (day: string) => queryDayIn(db, day)
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day))

  app.get<{ Querystring: { day?: string } }>('/api/energy-saving/query', async (req) => {
    const day = req.query.day ?? ''
    if (!validDay(day)) throw new HttpError(400, 'day must be YYYY-MM-DD')
    return queryDay(day)
  })

  /**
   * Price and plan of one day for API clients: the same price and plan tables, for a day
   * given as a word or a date (today, yesterday, 2026-10-24, 昨天, ...; see query-date.ts). `today` (YYYY-MM-DD) is the
   * caller's date for the words, else the server's. Adds a price summary and, for a day without data, the days that have it.
   */
  app.get<{ Querystring: { day?: string; today?: string } }>('/api/energy-saving/day-query', async (req) => {
    const { day: input, today } = req.query
    if (today !== undefined && !validDay(today)) throw new HttpError(400, 'today must be YYYY-MM-DD')
    try {
      return dayQuery(db, input, today ? new Date(`${today}T12:00:00`) : new Date())
    } catch (e) {
      if (e instanceof QueryDateError) throw new HttpError(400, e.message)
      throw e
    }
  })

  /**
   * The dialog's single entry (design doc 1.2): the text goes to the intent router, which lists every action the text
   * asks for (a task, the price, the plan, in any mix) and extracts their parameters. The actions run in order and
   * all results come back in `actions`. `today` is the browser's date so "today" and "yesterday" match the screen.
   * The first action is also copied to the top level of the answer for simple callers.
   */
  app.post('/api/energy-saving/chat', async (req) => {
    const { message, today: browserToday } = body(req)
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new HttpError(400, 'message must be 1 to 4000 characters')
    const now = typeof browserToday === 'string' && validDay(browserToday) ? new Date(`${browserToday}T12:00:00`) : new Date()
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    app.log.info({ logger: 'chat' }, record('Chat request', { characters: message.length }, { text: clip(message.replace(/\s+/g, ' '), 300) }))
    // The LLM decides (design doc 1.2). Without it, or without a usable answer, the request fails with the reason.
    const settings = llmSettings()
    const note: LlmOutcome = {}
    const route = await routeWithLlm(settings, message, iso, doFetch, app.log, note)
    if (!route) {
      app.log.error({ logger: 'chat' }, record('Request rejected', { reason: 'the LLM gave no usable answer' }, { cause: note.error }))
      throw new HttpError(502, note.error ?? 'The LLM gave no usable answer')
    }
    const intents: Intent[] = route.intents
    // The day of a query is the one the LLM worked out from the sentence and today's date. Only when its answer holds no valid date, today is used,
    // and the log says so (day_source), so a missing date is never taken for an understood one.
    const asksDay = intents.some((i) => i.startsWith('query'))
    const day = route.date ?? iso
    app.log.info(
      { logger: 'chat' },
      record('Intent resolved', { intents: intents.join(','), day: asksDay ? day : undefined, day_source: asksDay ? (route.date ? 'llm' : 'today') : undefined, read_by: `${settings.provider}/${settings.model}` }),
    )
    if (asksDay && !route.date) {
      app.log.warn({ logger: 'chat' }, record('The LLM gave no date', { used: iso }, { cause: 'The routing answer has no valid date (YYYY-MM-DD), so today is shown.', action: 'if the user asked for another day, use a stronger model or check the routing prompt (config/llm.config.json)' }))
    }
    // Step 1 of the skill: the parameters of a task, read once for the message, by the model with the parameter prompt.
    let taskParams: Promise<TaskParams> | undefined
    const paramsOf = () => (taskParams ??= paramsFromLlm(settings, message, note))

    const actions = await Promise.all(intents.map(async (intent) => {
      if (intent === 'submit-task') {
        const params = await paramsOf()
        try {
          const taskId = await submit(message, params)
          return { kind: 'task' as const, intent, success: true, taskId, params, message: 'Energy-saving task submitted successfully' }
        } catch (e) {
          if (!(e instanceof SkillError)) throw e
          return { kind: 'task' as const, intent, success: false, params, message: e.message }
        }
      }
      if (intent === 'unknown') {
        return { kind: 'unknown' as const, intent, message: 'Sorry, I can create an energy-saving task, query electricity prices, or query the charge/discharge plan.' }
      }
      return { kind: 'query' as const, intent, ...queryDay(day) }
    }))
    const { kind: _k, ...first } = actions[0]
    return { ...first, engine: 'llm', actions }
  })

}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import fastifyCompress from '@fastify/compress'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { LogController, type FastifyServerFactory } from 'fastify'
import { openDb, type Db } from './db.js'
import { DatabaseStructureError, structureProblems } from './db-check.js'
import { initLlmTable } from './llm.js'
import { pythonStyleLogger } from './logging.js'
import { maeFetch as verifiedFetch } from './mae/http-fetch.js'
import type { MaeFetch } from './mae/protocol.js'
import { message } from './trace.js'
import { createSkill } from './skills/energy-saving/index.js'
import { initTaskTables } from './tasks.js'
import { HttpError } from './http.js'
import { assertSafeValue, HighRiskInputError } from './guard/high-risk.js'
import { chargeDischargeRoutes } from './routes/charge-discharge.js'
import { energySavingRoutes } from './routes/energy-saving.js'
import { llmRoutes } from './routes/llm.js'
import { applyDataset, testDataRoutes } from './routes/test-data.js'
import { listDatasets, seedDefaults } from './test-data.js'

/** The version of the package (server/package.json), the same number ./start.sh status and /health show. */
export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

export interface AppOptions {
  dbPath: string
  /** The built pages: <publicDir>/dashboard (web/) is served at /dashboard. Optional so tests can run without a build. */
  publicDir?: string
  /** Lets the start script put another app on the same port (the save-strategy app at /strategy). */
  serverFactory?: FastifyServerFactory
  samplePath: string
  /** Used for calls to the LLM provider; tests pass a stub. */
  fetch?: typeof fetch
  /** The Network Agent: the real one at MAE_BASE_URL. The tests hand in a stand-in: a `fetch` of it, or a function that makes one from the database. */
  maeFetch?: MaeFetch
  maeFactory?: (db: Db) => MaeFetch
  maeBaseUrl?: string
  /** On a database with no price data, apply the first sample dataset, so a task works at once. The server start does it; tests do not. */
  seedPrices?: boolean
}

export async function buildApp(opts: AppOptions) {
  // Logs: on in production; in development switch them on with LOG_LEVEL (debug, info, warn), as the VS Code launch configs do.
  const level = process.env.LOG_LEVEL
  const production = process.env.NODE_ENV === 'production'
  // The lines follow the layout of the A2A projects (Python logging: date time - logger - LEVEL - message, see trace.ts); with
  // LOG_FORMAT=json they stay JSON, one object per line, for log tools.
  const pretty = process.env.LOG_FORMAT ? process.env.LOG_FORMAT === 'pretty' : !production
  const app = Fastify({
    // On stop, close idle keep-alive connections too, so ./start.sh stop never has to force it.
    forceCloseConnections: true,
    // The two lines per request ("incoming request", "request completed") are replaced by one line per API call, see below.
    logController: new LogController({ disableRequestLogging: true }),
    ...(opts.serverFactory ? { serverFactory: opts.serverFactory } : {}),
    ...(level && pretty ? { loggerInstance: pythonStyleLogger(level) } : { logger: level ? { level } : production }),
  })
  const db = openDb(opts.dbPath)
  // A database that was made by hand or by another program: its tables must be the ones of the application. The server does not start on
  // it, and the log says which table and which column, in a few lines. The code that fills the tables can fail on such a file before
  // the check is reached (a column it needs is not there), so the check also runs when it fails, to name the cause.
  const rejectForeignDatabase = async () => {
    if (opts.dbPath === ':memory:') return
    const reference = openDb(':memory:')
    initLlmTable(reference)
    initTaskTables(reference)
    const bad = structureProblems(db, reference)
    reference.close()
    if (!bad.length) return
    const shown = bad.slice(0, 6)
    app.log.error(
      { logger: 'startup' },
      message(
        'Server not started: the database does not match the application',
        { path: opts.dbPath, tables_wrong: bad.length },
        {
          cause: shown.join('\n') + (bad.length > shown.length ? `\n(and ${bad.length - shown.length} more)` : ''),
          action: 'use the database file of this application, or make a new one at another place: ./start.sh DB_PATH=<folder>/energy.db, then ./start.sh init-db; the tables must not be changed by hand',
        },
      ),
    )
    db.close()
    await app.close()
    throw new DatabaseStructureError(bad)
  }
  try {
    initLlmTable(db)
    initTaskTables(db)
  } catch (e) {
    await rejectForeignDatabase()
    throw e
  }
  await rejectForeignDatabase()
  // The MAE login is read from MAE_USERNAME and MAE_PASSWORD (config/app.env) when a token is needed; it is not kept in the database.
  // A login that an earlier version stored there (base64 of user:password) is removed.
  db.prepare("DELETE FROM system_config WHERE config_key='authentication'").run()
  const doFetch = opts.fetch ?? fetch
  seedDefaults(db)
  if (opts.seedPrices && !db.prepare('SELECT 1 FROM price_data LIMIT 1').get()) {
    const first = listDatasets(db)[0]
    if (first) applyDataset(db, first)
  }

  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

  // Same error shape the front end reads: { detail: string }.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : (err.statusCode ?? 500)
    // A failure the code reports on purpose (HttpError) has its own ERROR record and the API record; only a surprise is logged here.
    if (status >= 500 && !(err instanceof HttpError)) app.log.error(err)
    void reply.code(status).send({ detail: status >= 500 && !(err instanceof HttpError) ? 'internal error' : err.message })
  })

  // Every query and JSON body is checked for the customer's high-risk commands and for injection before a route sees it
  // (guard/high-risk.ts); uploaded files are checked cell by cell where they are read.
  app.addHook('preHandler', async (req) => {
    try {
      assertSafeValue(req.query, 'the query')
      if (req.body !== undefined && !req.isMultipart()) assertSafeValue(req.body, 'the request')
    } catch (e) {
      if (!(e instanceof HighRiskInputError)) throw e
      req.log.warn({ url: req.url }, e.message)
      throw new HttpError(400, e.message)
    }
  })

  // One record per API call: the method, the address, the status and the time. The polling of the pages (GET) is written only at
  // LOG_LEVEL=debug, and a failure always (4xx as WARNING, 5xx as ERROR).
  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0]
    if (!(path.startsWith('/api/') || path.startsWith('/strategy/api/'))) return
    const text = message('API call', { method: req.method, path, status: reply.statusCode, duration_ms: Math.round(reply.elapsedTime ?? 0) })
    const o = { logger: 'api' }
    if (reply.statusCode >= 500) req.log.error(o, text)
    else if (reply.statusCode >= 400) req.log.warn(o, text)
    else if (req.method === 'GET') req.log.debug(o, text)
    else req.log.info(o, text)
  })

  app.get('/health', async () => ({ status: 'ok', version: VERSION }))
  chargeDischargeRoutes(app, db, opts.samplePath)
  // The Network Agent at MAE_BASE_URL. A connection that gets no answer within MAE_TIMEOUT_MS is given up (the timer stops once the
  // answer starts, so a long A2A-T stream is not cut).
  const maeTimeout = Number(process.env.MAE_TIMEOUT_MS) > 0 ? Number(process.env.MAE_TIMEOUT_MS) : 8000
  const realFetch: MaeFetch = async (u, i) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), maeTimeout)
    try {
      return await verifiedFetch(u, { ...i, signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  const maeFetch: MaeFetch = opts.maeFetch ?? opts.maeFactory?.(db) ?? realFetch
  const maeBase = (opts.maeBaseUrl ?? process.env.MAE_BASE_URL ?? '').replace(/\/+$/, '')
  const skill = createSkill(db, maeFetch, maeBase, app.log)
  energySavingRoutes(app, db, doFetch, skill)

  testDataRoutes(app, db)
  llmRoutes(app, db, doFetch)

  const dashboard = opts.publicDir && join(opts.publicDir, 'dashboard')
  if (dashboard && existsSync(join(dashboard, 'index.html'))) {
    // Gzip text assets; hashed files under /assets never change, so browsers may keep them for a year.
    await app.register(fastifyCompress, { threshold: 1024 })
    await app.register(fastifyStatic, {
      root: dashboard,
      prefix: '/dashboard/',
      setHeaders: (res, path) => {
        if (relative(dashboard, path).split(sep)[0] === 'assets') res.header('cache-control', 'public, max-age=31536000, immutable')
        else res.header('cache-control', 'no-cache')
      },
    })
    app.get('/dashboard', async (_req, reply) => reply.redirect('/dashboard/'))
  } else {
    app.get('/dashboard/', async (_req, reply) => reply.type('text/plain').send('Front end not built. Run: npm run build'))
  }
  app.get('/', async (_req, reply) => reply.redirect('/dashboard/'))
  app.addHook('onClose', async () => db.close())
  return app
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildApp, VERSION } from './app.js'
import { fromEnv } from './llm.js'
import { DatabaseStructureError } from './db-check.js'
import { maeFetch, tlsSettings } from './mae/http-fetch.js'
import { checkMaeLogin } from './startup-check.js'
import { formatRecord } from './logging.js'
import { message } from './trace.js'

// The settings come from the environment: start.sh hands over config/app.env, whose values win over the shell's. See config/app.env.example.
// server/src and server/dist both sit one level below server/.
const serverDir = join(import.meta.dirname, '..')
// DB_PATH: relative paths start at the install folder (the one with start.sh), whatever the working directory is.
const dbPath = process.env.DB_PATH === ':memory:' ? ':memory:' : resolve(serverDir, '..', process.env.DB_PATH ?? join('data', 'energy.db'))
// The save-strategy app reads the same variable, so both parts use one database file.
process.env.DB_PATH = dbPath
const publicDir = process.env.PUBLIC_DIR ?? join(serverDir, 'public')

// The database file must exist (./start.sh init-db makes it; DB_CREATE=true lets a developer start on a new file). Nothing below may make it
// silently: the strategy app opens the file as soon as it is imported.
if (dbPath !== ':memory:' && !existsSync(dbPath) && process.env.DB_CREATE !== 'true') {
  const text = message(
    'Server not started: the database file does not exist',
    { path: dbPath },
    {
      cause: 'DB_PATH points to a file that is not there.',
      action: './start.sh init-db   (makes the folder and the file and fills all tables), or put your database file there; then ./start.sh',
    },
  )
  process.stdout.write(formatRecord(JSON.stringify({ time: Date.now(), level: 50, logger: 'startup', msg: text })) + '\n')
  process.exit(1)
}

// The save-strategy app is an Express app; it answers everything under /strategy on the same port.
const { mountStrategy } = await import('./save-strategy/mount.js')
const strategy = mountStrategy(join(publicDir, 'strategy'))

let lastMissingLog = 0
const app = await buildApp({
  dbPath,
  publicDir,
  seedPrices: true,
  samplePath: process.env.SAMPLE_PATH ?? join(serverDir, '..', 'sample', 'price_data.xlsx'),
  serverFactory: (handler) =>
    createServer((req: IncomingMessage, res: ServerResponse) => {
      // A database file that is removed while the server runs is an error, not something to keep working around: on Linux the server
      // would go on with the deleted file and lose everything at the next start. The API says so; the log has one record a minute.
      if (dbPath !== ':memory:' && (req.url?.startsWith('/api/') || req.url?.startsWith('/strategy/api/')) && !existsSync(dbPath)) {
        const cause = `The database file ${dbPath} does not exist any more.`
        const action = 'restore the file, or ./start.sh stop, ./start.sh init-db and ./start.sh (a new, empty database)'
        if (Date.now() - lastMissingLog > 60_000) {
          lastMissingLog = Date.now()
          app.log.error({ logger: 'api' }, message('Database file is missing while the server runs', { path: dbPath }, { cause, action }))
        }
        res.writeHead(503, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify({ detail: `${cause} Fix: ${action}` }))
      }
      if (req.url === '/strategy' || req.url?.startsWith('/strategy/')) return strategy(req, res)
      handler(req, res)
    }),
}).catch((e: unknown) => {
  if (e instanceof DatabaseStructureError) process.exit(1) // the record with the tables and columns is in the log
  throw e
})

const port = Number(process.env.PORT ?? 8000)
const host = process.env.HOST ?? '0.0.0.0'
await app.listen({ port, host })
// ./start.sh stop asks politely (SIGTERM): finish open requests, close the database, then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'stopping')
    setTimeout(() => process.exit(1), 5000).unref()
    void app.close().then(() => process.exit(0))
  })
}
// What runs (never a key or a password), and what is missing: the server starts either way and says so in the log.
const log = app.log
const llmNow = fromEnv()
const llmKey = process.env.LLM_ENABLED === 'true' && llmNow.apiKey
log.info(
  { logger: 'startup' },
  message('Server started', {
    version: VERSION,
    port,
    database: dbPath,
    llm: llmKey ? `${llmNow.provider}/${llmNow.model || '(first model the server lists)'}` : 'not configured',
    mae_url: process.env.MAE_BASE_URL || 'not configured',
    mae_user: process.env.MAE_USERNAME || 'not configured',
  }),
)
if (!llmKey) {
  log.error(
    { logger: 'startup' },
    message('LLM is not configured', {}, {
      cause: process.env.LLM_ENABLED !== 'true' ? 'LLM_ENABLED is not true.' : 'LLM_API_KEY is empty.',
      effect: 'every request of the dialog fails until the LLM is set',
      action: './start.sh LLM_PROVIDER=<provider> LLM_MODEL=<model> LLM_API_KEY=<key>   then test: ./start.sh check-llm',
    }),
  )
}
if (!/^https?:\/\/[^/\s]+/.test(process.env.MAE_BASE_URL || '') || !process.env.MAE_USERNAME || !process.env.MAE_PASSWORD) {
  log.error(
    { logger: 'startup' },
    message('Network Agent is not configured', {}, {
      cause: 'MAE_BASE_URL (http://<host>:<port>), MAE_USERNAME or MAE_PASSWORD is missing.',
      effect: 'every task fails until they are set',
      action: './start.sh MAE_BASE_URL=http://<host>:<port> MAE_USERNAME=<user> MAE_PASSWORD=<password>   then test: ./start.sh check-mae',
    }),
  )
} else {
  // One login at start, so a wrong address or login is in the log before the first task. Nothing else is sent.
  void checkMaeLogin(process.env.MAE_BASE_URL ?? '', process.env.MAE_USERNAME ?? '', process.env.MAE_PASSWORD ?? '', log, maeFetch)
  try {
    if (/^https:/i.test(process.env.MAE_BASE_URL ?? '') && !tlsSettings().rejectUnauthorized) {
      log.warn(
        { logger: 'startup' },
        message('The certificate of the Network Agent is not checked', {}, {
          cause: 'MAE_TLS_VERIFY=false.',
          effect: 'the MAE login and the tasks travel over a connection that is not authenticated',
          action: 'set MAE_CA_FILE=<certificate of the Network Agent (PEM)> and remove MAE_TLS_VERIFY=false',
        }),
      )
    }
  } catch {
    // an unreadable MAE_CA_FILE is reported by the first MAE call
  }
}
if (!existsSync(join(publicDir, 'dashboard', 'index.html'))) app.log.warn('the pages are not built: run npm run build')

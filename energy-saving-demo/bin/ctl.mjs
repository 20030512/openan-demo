// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Control program of the installed package: start, stop, status, settings, backup.
// Every step is done here, in Node.js, so the operator types only ./start.sh, ./start.sh stop, ./start.sh status, ./start.sh settings and
// ./start.sh backup and ./start.sh query: no shell command of the customer's high-risk list (cp, mv, rm, mkdir, vi, sed, echo > file, cat, grep,
// chmod, su, sudo, kill, systemctl, database tools ...) is needed, and none is run by these scripts.
import { spawn } from 'node:child_process'
import { accessSync, appendFileSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkMae, llmLine, maeLine, problems, withInternalDefaults } from './preflight.mjs'

const root = resolve(import.meta.dirname, '..')
const CONFIG = join(root, 'config', 'app.env')
const EXAMPLE = join(root, 'config', 'app.env.example')
const PIDFILE = join(root, 'run', 'server.pid')
const LOGFILE = join(root, 'logs', 'server.log')
const SECRET = /KEY|PASSWORD|TOKEN|SECRET/

const say = (s) => process.stdout.write(s + '\n')
// Output read only in part (for example piped into tail): stop quietly instead of failing.
process.stdout.on('error', (e) => (e.code === 'EPIPE' ? process.exit(0) : fail(e.message)))
const fail = (s) => {
  process.stderr.write(s + '\n')
  process.exit(1)
}

/**
 * A record in logs/server.log in the layout of the server (see server/src/trace.ts): `date time - name - LEVEL - message`, the texts on
 * indented lines. For what happens before the server runs (a database that is missing, a folder that cannot be made), so the log tells it
 * too, not only the screen. Best effort: when the log folder cannot be made either, the screen is all there is.
 */
function logRecord(level, logger, event, fields = {}, texts = {}) {
  try {
    const two = (n) => String(n).padStart(2, '0')
    const d = new Date()
    const time = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
    const kv = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v) !== '' && !/[\s"=]/.test(String(v)) ? v : JSON.stringify(String(v))}`)
    const lines = [`${time} - ${logger} - ${level} - ${kv.length ? `${event}: ${kv.join(' ')}` : event}`]
    for (const [label, text] of Object.entries(texts)) {
      if (!text) continue
      const parts = String(text).split('\n')
      lines.push(`    ${label}: ${parts[0]}`, ...parts.slice(1).map((p) => `        ${p}`))
    }
    mkdirSync(dirname(LOGFILE), { recursive: true })
    appendFileSync(LOGFILE, lines.join('\n') + '\n')
  } catch {
    /* the screen has it */
  }
}

/** Make a folder, or say in words why it cannot be made (the database folder of DB_PATH is the usual one). */
function makeDir(dir, what = 'a folder') {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    const why = e.code === 'EACCES' || e.code === 'EPERM' ? 'this user may not write there' : e.code === 'EROFS' ? 'the file system is read-only' : e.message
    const action = 'use a folder this user can write: ./start.sh DB_PATH=<folder>/energy.db (for example ./start.sh DB_PATH=data/energy.db)'
    logRecord('ERROR', 'startup', `Folder could not be made: path=${dir}`, { purpose: what }, { cause: why, action })
    fail(`Cannot make ${what} ${dir}: ${why}.\n  Use a folder this user can write: ./start.sh DB_PATH=<folder>/energy.db (for example ./start.sh DB_PATH=data/energy.db)`)
  }
}

function readEnv(file = CONFIG) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

/** The settings file: made from the example the first time (no copy command needed). */
function ensureConfig() {
  if (existsSync(CONFIG)) return false
  writeFileSync(CONFIG, readFileSync(EXAMPLE, 'utf8'))
  return true
}

function checks() {
  const [a, b] = process.versions.node.split('.').map(Number)
  if (!(a > 22 || (a === 22 && b >= 13))) fail(`Node ${process.version} is too old: 22.13 or newer is needed (node:sqlite).`)
  // A privileged account is on the high-risk list: the server runs as a normal user (the default port 8000 needs no rights).
  if (typeof process.getuid === 'function' && process.getuid() === 0) fail('Do not run as root: start it as the normal user that owns this folder.')
  if (!existsSync(join(root, 'server', 'dist', 'index.js')) || !existsSync(join(root, 'server', 'node_modules')))
    fail('This folder is not a built package: server/dist or server/node_modules is missing (see README, "Build the package").')
}

function runningPid() {
  if (!existsSync(PIDFILE)) return null
  const pid = Number(readFileSync(PIDFILE, 'utf8'))
  try {
    process.kill(pid, 0)
    // A process that has ended but is not collected yet (a zombie) still answers signal 0. In a container whose first process does not
    // collect its children this made every ./start.sh stop wait 10 s and report "forced". On Linux the state in /proc says it.
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      if (stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) === 'Z') throw new Error('zombie')
    } catch (e) {
      if (e.message === 'zombie') throw e
    }
    return pid
  } catch {
    unlinkSync(PIDFILE)
    return null
  }
}

/**
 * ./start.sh init-db: makes the database file (and its folder) at DB_PATH when it is not there, and fills it with all tables and the
 * structure. A database that does not exist is an error at start (see databaseProblem); this is the command that makes it. The package
 * ships an empty database at the default place, so the default needs no command. Example prices and a strategy are
 * written on the first start of the server, not here, so a file never holds dates that are already old. `init --empty` (the package
 * builder) is the same.
 */
async function initDb() {
  const env = readEnv(existsSync(CONFIG) ? CONFIG : EXAMPLE)
  const file = dbPath(env)
  if (existsSync(file)) {
    say(`Database exists: ${file} (its tables are filled when the server starts)`)
    return
  }
  makeDir(dirname(file), 'the database folder')
  // The database is made in this process, quietly. Its settings must not stay in the environment of this process (the first start
  // had no log, LOG_LEVEL=error): they are put back below.
  const before = { ...process.env }
  Object.assign(process.env, env, { DB_PATH: file, LOG_LEVEL: 'error', LOG_FORMAT: 'json', DB_CREATE: 'true' })
  try {
    const { buildApp } = await import(pathToFileURL(join(root, 'server', 'dist', 'app.js')).href)
    const app = await buildApp({ dbPath: file, samplePath: join(root, 'sample', 'price_data.xlsx'), seedPrices: false })
    await app.close()
  } catch (e) {
    logRecord('ERROR', 'startup', `Database could not be made: path=${file}`, {}, { cause: e.message, action: 'check the folder and the free space, then ./start.sh init-db' })
    fail(`Cannot make the database ${file}: ${e.message}`)
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]
    Object.assign(process.env, before)
  }
  logRecord('INFO', 'startup', `Database made: path=${file}`, {}, { next: 'the tables and the structure are filled; the example prices are added at the first start of the server' })
  say(`Database made: ${file}`)
}

/** What is wrong with the database file at DB_PATH, or null: it must exist, and this user must be able to read and write it. */
function databaseProblem(env) {
  const file = dbPath(env)
  if (!existsSync(file)) {
    return { file, summary: 'the database file does not exist', cause: `DB_PATH points to a file that is not there: ${file}`, action: './start.sh init-db   (makes the folder and the file and fills all tables), or put your database file there; then ./start.sh' }
  }
  try {
    accessSync(file, constants.R_OK | constants.W_OK)
  } catch {
    return { file, summary: 'the database file cannot be read and written', cause: `this user has no read and write right on ${file}`, action: 'give this user the right on the file and its folder, or use another file: ./start.sh DB_PATH=<folder>/energy.db' }
  }
  return null
}

function dbPath(env) {
  const p = env.DB_PATH || 'data/energy.db'
  return isAbsolute(p) ? p : resolve(root, p)
}

function serverArgs() {
  return ['--disable-warning=ExperimentalWarning', join(root, 'server', 'dist', 'index.js')]
}

/**
 * The environment of the server: the settings of config/app.env win over variables the shell already has. (node --env-file keeps a
 * variable that is already set, so a MAE_BASE_URL left in the user's environment made the server use another Network Agent than the one
 * check-mae had just tested.) The server runs with exactly what ./start.sh settings, status and the checks show.
 */
const serverEnv = (inherited, settings) => ({ ...inherited, ...settings })

/** ./start.sh [NAME=value ...] [--foreground]: saves the settings given, checks them, makes the database, starts. */
async function start(args) {
  const foreground = args.includes('--foreground') || args.includes('-f')
  const settings = args.filter((a) => /^[A-Z][A-Z0-9_]*=/.test(a))
  const other = args.filter((a) => !settings.includes(a) && a !== '--foreground' && a !== '-f')
  if (other.length) fail(`Unknown command or setting: ${other.join(' ')}. A setting is written NAME=value. Run ./start.sh help for the commands.`)
  checks()
  if (ensureConfig()) say('Made config/app.env from config/app.env.example.')
  if (settings.length) {
    saveSettings(settings)
    if (runningPid()) return say('Saved. It runs with the old settings until it is restarted: ./start.sh stop, then ./start.sh')
  }
  const env = readEnv()
  // A missing setting does not stop the start. The server starts, writes the same problem as an ERROR record to its log, and the
  // request that needs the setting fails with the reason. Here it is said once on the screen as well.
  const missing = problems(env)
  const pid = runningPid()
  if (pid) fail(`Already running (pid ${pid}). Stop it with ./start.sh stop`)
  makeDir(join(root, 'logs'), 'the log folder')
  makeDir(join(root, 'run'), 'the run folder')
  // The database is the one thing the server cannot work without: it must exist (./start.sh init-db makes it).
  const dbBad = databaseProblem(env)
  if (dbBad) {
    logRecord('ERROR', 'startup', `Server not started: ${dbBad.summary}: path=${dbBad.file}`, {}, { cause: dbBad.cause, action: dbBad.action })
    fail(`ERROR: ${dbBad.summary}: ${dbBad.file}\n  cause:  ${dbBad.cause}\n  action: ${dbBad.action}`)
  }
  const warn = () => {
    for (const m of missing) process.stderr.write(`WARNING: ${m.what}\n         Fix: ${m.fix}\n`)
    if (missing.length) process.stderr.write('The server runs anyway; requests that need these settings fail and the log says why.\n')
  }
  if (foreground) {
    warn()
    const child = spawn(process.execPath, serverArgs(), { cwd: root, env: serverEnv(process.env, env), stdio: 'inherit' })
    const pass = (sig) => child.kill(sig)
    process.on('SIGINT', pass).on('SIGTERM', pass)
    child.on('exit', (code) => process.exit(code ?? 0))
    return
  }
  const log = openSync(LOGFILE, 'a')
  const child = spawn(process.execPath, serverArgs(), { cwd: root, env: serverEnv(process.env, env), detached: true, stdio: ['ignore', log, log] })
  closeSync(log)
  writeFileSync(PIDFILE, String(child.pid))
  child.unref()
  // "Started" is said when the server answers, not when its process exists: the pages and ./start.sh status work right after it.
  const port = env.PORT || '8000'
  const answers = async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok
    } catch {
      return false
    }
  }
  let up = false
  for (let waited = 0; waited < 30000 && !up; waited += 250) {
    await new Promise((r) => setTimeout(r, 250))
    if (!runningPid()) {
      const tail = readFileSync(LOGFILE, 'utf8').split('\n').slice(-20).join('\n')
      fail('The server stopped at once. Last lines of logs/server.log:\n' + tail)
    }
    up = await answers()
  }
  if (!up) say(`WARNING: the server runs (pid ${child.pid}) but does not answer on port ${port} after 30 s. Look at logs/server.log; ./start.sh status says when it answers.`)
  say(`Started (pid ${child.pid}). Dashboard: http://localhost:${port}/dashboard/  Strategy: http://localhost:${port}/strategy/`)
  say('Logs: logs/server.log (tail -f logs/server.log)')
  say(maeLine(env))
  say(llmLine(env))
  warn()
}

async function stop() {
  const pid = runningPid()
  if (!pid) return say('Not running.')
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (!runningPid()) return say('Stopped.')
  }
  process.kill(pid, 'SIGKILL')
  if (existsSync(PIDFILE)) unlinkSync(PIDFILE)
  say('Stopped (forced).')
}

async function status() {
  const pid = runningPid()
  const env = existsSync(CONFIG) ? readEnv() : {}
  say(pid ? `Running (pid ${pid}).` : 'Not running.')
  if (pid) {
    try {
      const r = await fetch(`http://127.0.0.1:${env.PORT || 8000}/health`)
      say(`Health: ${r.status} ${await r.text()}`)
    } catch (e) {
      say(`Health: no answer (${e.message})`)
    }
  }
  say(llmLine(env))
  say(maeLine(env))
  say(`Database: ${dbPath(env)}${existsSync(dbPath(env)) ? ` (${(statSync(dbPath(env)).size / 1e6).toFixed(1)} MB)` : ' MISSING: ./start.sh init-db makes it'}`)
}

/** The settings given as NAME=value: only names of config/app.env.example, saved in config/app.env (a restart applies them). */
function saveSettings(args) {
  const known = new Set(Object.keys(readEnv(EXAMPLE)))
  let text = readFileSync(CONFIG, 'utf8')
  for (const a of args) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(a)
    if (!m) fail(`Not a setting: ${a} (write NAME=value)`)
    if (!known.has(m[1])) fail(`Unknown setting ${m[1]}. Known: ${[...known].join(', ')}`)
    const line = new RegExp(`^${m[1]}=.*$`, 'm')
    text = line.test(text) ? text.replace(line, `${m[1]}=${m[2]}`) : `${text.replace(/\n?$/, '\n')}${m[1]}=${m[2]}\n`
    say(`${m[1]}=${SECRET.test(m[1]) && m[2] ? m[2].slice(0, 3) + '…' : m[2]}`)
  }
  writeFileSync(CONFIG, text)
}

/** ./start.sh settings: shows every setting (secrets hidden). */
async function settings() {
  if (ensureConfig()) say('Made config/app.env from config/app.env.example.')
  for (const [k, v] of Object.entries(readEnv())) say(`${k}=${SECRET.test(k) && v ? v.slice(0, 3) + '…' : v}`)
}

/** ./start.sh update <old folder>: takes config/app.env and the data (the database, copied consistently) of an older install. */
async function update(args) {
  const old = resolve(args[0] ?? '')
  const from = join(old, 'config', 'app.env')
  if (!args[0] || !existsSync(from)) fail(`Use: ./start.sh update <old folder> (with config/app.env in it). Not found: ${from}`)
  checks()
  copyFileSync(from, CONFIG)
  say(`Settings taken from ${from}.`)
  const oldEnv = readEnv(from)
  const oldDb = isAbsolute(oldEnv.DB_PATH || 'data/energy.db') ? oldEnv.DB_PATH || 'data/energy.db' : resolve(old, oldEnv.DB_PATH || 'data/energy.db')
  const newDb = dbPath(readEnv())
  if (existsSync(oldDb) && oldDb !== newDb) {
    if (runningPid()) fail('Stop the server first (./start.sh stop).')
    if (existsSync(newDb)) unlinkSync(newDb)
    for (const ext of ['-wal', '-shm']) if (existsSync(newDb + ext)) unlinkSync(newDb + ext)
    mkdirSync(dirname(newDb), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const source = new DatabaseSync(oldDb, { readOnly: true })
    source.exec(`VACUUM INTO '${newDb.replace(/'/g, "''")}'`)
    source.close()
    say(`Data taken from ${oldDb}.`)
  }
  say('Now start it: ./start.sh')
}

/**
 * ./start.sh check-llm [NAME=value ...]: saves the settings given, then makes one small call to the model with the settings of config/app.env, the same call the dialog
 * makes. Prints OK with the answer, or the reason the provider gave (wrong key, wrong model name, no route to the address).
 */
async function checkLlm(args = []) {
  checks()
  ensureConfig()
  const given = args.filter((a) => /^[A-Z][A-Z0-9_]*=/.test(a))
  if (args.length !== given.length) fail(`Use: ./start.sh check-llm [NAME=value ...] (the settings are saved, the model is asked, nothing is started)`)
  if (given.length) saveSettings(given)
  const env = withInternalDefaults(readEnv())
  const missing = problems(env).filter((p) => p.what.includes('LLM'))
  if (missing.length) {
    for (const m of missing) process.stderr.write(`  - ${m.what}\n      fix: ${m.fix}\n`)
    process.exit(1)
  }
  // The server reads every LLM_* setting (timeout, temperature, effort ...) from its environment; this process asks the model the same way.
  for (const [k, v] of Object.entries(env)) if (k.startsWith('LLM_')) process.env[k] = v
  const dist = join(root, 'server', 'dist')
  if (!existsSync(join(dist, 'llm.js'))) fail('server/dist is missing: this is not a built package.')
  const { PRESETS, testSettings } = await import(pathToFileURL(join(dist, 'llm.js')).href)
  const preset = PRESETS.find((x) => x.id === env.LLM_PROVIDER) ?? PRESETS[0]
  const settings = { enabled: true, provider: preset.id, baseUrl: env.LLM_BASE_URL || preset.baseUrl, model: env.LLM_MODEL || preset.model, apiKey: env.LLM_API_KEY }
  say(`Asking ${settings.model || 'the first model the server lists'} at ${settings.baseUrl} …`)
  const r = await testSettings(settings)
  if (r.ok) say(`OK (${r.ms} ms): the model answered "${r.reply}".`)
  else {
    process.stderr.write(`The model did not answer (${r.ms} ms): ${r.error}\n`)
    // What the error means and what to do (429, wrong key, wrong model name ...), in words.
    if (r.hint) process.stderr.write(`  -> ${r.hint}\n`)
    process.exit(1)
  }
}

/** ./start.sh check-mae [NAME=value ...]: saves the settings given, logs in once at the Network Agent and says what is wrong; nothing is started. */
async function checkMaeCommand(args = []) {
  checks()
  ensureConfig()
  const given = args.filter((a) => /^[A-Z][A-Z0-9_]*=/.test(a))
  if (args.length !== given.length) fail('Use: ./start.sh check-mae [NAME=value ...] (the settings are saved, the Network Agent is asked once, nothing is started)')
  if (given.length) saveSettings(given)
  const env = readEnv()
  say(maeLine(env, false))
  const dist = join(root, 'server', 'dist')
  if (!existsSync(join(dist, 'mae', 'protocol.js'))) fail('server/dist is missing: this is not a built package.')
  const { TOKEN_PATH } = await import(pathToFileURL(join(dist, 'mae', 'protocol.js')).href)
  // The certificate of an https Network Agent is checked as the server does (MAE_TLS_VERIFY, MAE_CA_FILE).
  const { maeFetch } = await import(pathToFileURL(join(dist, 'mae', 'http-fetch.js')).href)
  const r = await checkMae(env, TOKEN_PATH, maeFetch)
  if (r.ok) say(r.text)
  else {
    process.stderr.write(r.text + '\n')
    process.exit(1)
  }
}

/** ./start.sh backup [file]: a consistent copy of the database, also while the server runs (SQLite VACUUM INTO). */
async function backup(args) {
  const env = existsSync(CONFIG) ? readEnv() : {}
  const db = dbPath(env)
  if (!existsSync(db)) fail(`No database at ${db}. ./start.sh init-db makes it.`)
  // Local time, as in logs/server.log, so the name matches the clock of the machine.
  const d = new Date()
  const two = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  const target = resolve(args[0] ?? join(root, 'backup', `energy-${stamp}.db`))
  if (existsSync(target)) fail(`${target} exists already`)
  mkdirSync(dirname(target), { recursive: true })
  const { DatabaseSync } = await import('node:sqlite')
  const source = new DatabaseSync(db, { readOnly: true })
  source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  source.close()
  say(`Backup: ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)`)
}

const TEXT = {
  en: {
    price: 'Dynamic electricity price',
    plan: 'Charge/discharge plan',
    priceHead: ['Date', 'Time slot', 'Price'],
    planHead: ['Date', 'Start', 'End', 'Stage'],
    LOW: 'LOW · charge',
    PEAK: 'PEAK · discharge',
    unit: 'Prices in CNY/kWh.',
    summary: (lo, hi, avg) => `Cheapest ${lo}, most expensive ${hi}, average ${avg}.`,
    oneTier: (p) => `The price is ${p} all day (one price level).`,
    hold: 'Periods not listed hold (no charging or discharging).',
    noShift: 'One price level all day: no charging or discharging is planned.',
    noData: (d) => `There are no electricity prices for ${d}.`,
    available: (a, b, n) => `Prices exist for ${n} day(s): ${a} to ${b}.`,
    none: 'There are no prices at all yet. Import a price file or apply a test dataset first.',
  },
  zh: {
    price: '动态电价',
    plan: '充放电计划',
    priceHead: ['日期', '时段', '电价'],
    planHead: ['日期', '开始', '结束', '阶段'],
    LOW: 'LOW · 充电',
    PEAK: 'PEAK · 放电',
    unit: '电价单位：元/千瓦时。',
    summary: (lo, hi, avg) => `最低 ${lo}，最高 ${hi}，平均 ${avg}。`,
    oneTier: (p) => `全天电价均为 ${p}（单一电价档）。`,
    hold: '未列出的时段保持不动（不充电也不放电）。',
    noShift: '全天只有一个电价档，不安排充放电。',
    noData: (d) => `${d} 没有电价数据。`,
    available: (a, b, n) => `已有 ${n} 天的电价：${a} 至 ${b}。`,
    none: '目前没有任何电价数据，请先导入电价文件或应用测试数据。',
  },
}

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
/** ["00:00-01:00", "01:00-02:00", "05:00-06:00"] -> "00:00-02:00, 05:00-06:00" */
function ranges(slots) {
  const out = []
  for (const s of slots) {
    const [a, b] = s.split('-')
    const last = out[out.length - 1]
    if (last && last[1] === a) last[1] = b
    else out.push([a, b])
  }
  return out.map(([a, b]) => `${a}-${b}`).join(', ')
}

/**
 * ./start.sh query [day] [--price | --plan] [--zh] [--json]: the price and the charge/discharge plan of one day, read straight
 * from the database file (read-only) with the server's own query code (server/dist/day-query.js). No URL, no running
 * server. The day is a word or a date: today (default), yesterday, tomorrow, "day before yesterday", "3 days ago", 昨天,
 * 2026-10-24 ...; it is checked against the high-risk list like every other input.
 */
async function query(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const input = args.filter((a) => !a.startsWith('--')).join(' ').trim() || 'today'
  const t = TEXT[flags.has('--zh') ? 'zh' : 'en']
  const show = flags.has('--price') ? 'price' : flags.has('--plan') ? 'plan' : 'both'
  const dist = join(root, 'server', 'dist')
  if (!existsSync(join(dist, 'day-query.js'))) fail('server/dist is missing: this is not a built package (see README, "Build the package").')
  const { assertSafeText, HighRiskInputError } = await import(pathToFileURL(join(dist, 'guard', 'high-risk.js')).href)
  const { dayQuery } = await import(pathToFileURL(join(dist, 'day-query.js')).href)
  const { QueryDateError } = await import(pathToFileURL(join(dist, 'query-date.js')).href)
  try {
    assertSafeText(input, 'the day')
  } catch (e) {
    if (e instanceof HighRiskInputError) fail(e.message)
    throw e
  }
  const env = existsSync(CONFIG) ? readEnv() : {}
  const db = dbPath(env)
  if (!existsSync(db)) fail(`No database at ${db}. ./start.sh init-db makes it.`)
  const { DatabaseSync } = await import('node:sqlite')
  const conn = new DatabaseSync(db, { readOnly: true })
  let q
  try {
    q = dayQuery(conn, input)
  } catch (e) {
    if (e instanceof QueryDateError) fail(`${e.message}`)
    throw e
  } finally {
    conn.close()
  }
  if (flags.has('--json')) return say(JSON.stringify(q, null, 2))
  const parts = []
  if (!q.prices.length) {
    const a = q.availableDates ?? []
    parts.push(t.noData(q.day), a.length ? t.available(a[0], a[a.length - 1], a.length) : t.none)
  } else {
    if (show !== 'plan') {
      parts.push(`${t.price} · ${q.day}`, table(t.priceHead, q.prices.map((p) => [p.date, p.timeSlot, p.price.toFixed(2)])), t.unit)
      const s = q.summary
      if (s)
        parts.push(
          s.tiers === 1
            ? t.oneTier(s.min.price.toFixed(2))
            : t.summary(`${s.min.price.toFixed(2)} (${ranges(s.min.timeSlots)})`, `${s.max.price.toFixed(2)} (${ranges(s.max.timeSlots)})`, s.average.toFixed(2)),
        )
    }
    if (show !== 'price') {
      parts.push(`${t.plan} · ${q.day}`)
      if (q.plan.length) parts.push(table(t.planHead, q.plan.map((p) => [p.date, p.startTime, p.endTime, t[p.stage] ?? p.stage])), t.hold)
      else parts.push(t.noShift)
    }
  }
  say(parts.join('\n\n'))
}

const HELP = {
  start: `./start.sh [NAME=value ...] [--foreground]
  Saves the settings given in config/app.env, makes the database if it does not exist, and starts the server in the background.
  The server starts even when the LLM or the Network Agent is not set; it says what is missing on the screen and in logs/server.log, and a
  request that needs the missing setting fails with the reason. It does not start without the database file (./start.sh init-db makes it). --foreground keeps it in this terminal (for a container).
  A server that runs keeps its old settings until ./start.sh stop and the next start.`,
  stop: './start.sh stop\n  Stops the server (it finishes the open requests first).',
  status: './start.sh status\n  Whether the server runs, its health and version, and the LLM, MAE and database settings (never a key or a password).',
  settings: './start.sh settings\n  Prints the saved settings of config/app.env (keys and passwords cut).',
  'init-db': `./start.sh init-db
  Makes the database file (and its folder) at DB_PATH when it is not there, and fills it with all tables. A database that does not exist is an
  error at start (screen and logs/server.log); this is the command that makes it. The package already holds an empty database at the default place.`,
  'check-llm': `./start.sh check-llm [NAME=value ...]
  Saves the settings given, asks the LLM one short question and says what happened. Nothing is started.
  A failure says what it means: wrong key, wrong model name, busy model (429), no network.`,
  'check-mae': `./start.sh check-mae [NAME=value ...]
  Saves the settings given and logs in once at the Network Agent. Nothing is started. A failure says which part is wrong: the address,
  the port, no answer in time, not a Network Agent, or the user name or password.`,
  backup: './start.sh backup [file]\n  Writes a consistent copy of the database (also while the server runs). Default: backup/energy-<time>.db.',
  query: './start.sh query [day] [--price | --plan] [--zh] [--json]\n  Prints the electricity price and the charge/discharge plan of a day (today, yesterday, a date) without a browser.',
  update: './start.sh update <old folder>\n  Takes config/app.env and the data of an older install into this one.',
  help: './start.sh help [command]\n  This text, or the help of one command.',
}

function help(args) {
  const one = args[0]
  if (one) {
    const text = HELP[one]
    if (!text) fail(`No help for "${one}". Commands: ${Object.keys(HELP).filter((k) => k !== 'start').join(', ')}`)
    return say(text)
  }
  say(`Energy-Saving Agent: control program of the installed package.

Usage
  ./start.sh [NAME=value ...] [--foreground]   save the settings given and start the server
  ./start.sh <command> [arguments]

Commands
  stop                          stop the server
  status                        running or not, health, LLM, MAE and database
  settings                      show the saved settings
  init-db                       make the database file at DB_PATH and fill its tables
  check-llm [NAME=value ...]    save the settings given, ask the LLM once, start nothing
  check-mae [NAME=value ...]    save the settings given, log in once at the Network Agent, start nothing
  backup [file]                 copy of the database
  query [day] [options]         electricity price and charge/discharge plan of a day
  update <old folder>           take the settings and the data of an older install
  help [command]                this text, or the help of one command

Settings (NAME=value, saved in config/app.env, applied at the next start)
  LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL   the model that reads the sentences of the dialog
                                                        (a model inside the network: LLM_BASE_URL alone is enough)
  LLM_TIMEOUT_SECONDS                                   seconds to wait for the model (default 300 = 5 minutes)
  LLM_REASONING_EFFORT, LLM_TEMPERATURE, LLM_MAX_TOKENS  optional, for models with their own rules
  MAE_BASE_URL, MAE_USERNAME, MAE_PASSWORD              the Network Agent that receives the tasks
  DB_PATH, PORT, LOG_LEVEL                              database file, port, detail of the log
  The full list with defaults is in config/app.env.example.

First start
  ./start.sh init-db            (only when DB_PATH is not the default place: the package has an empty database there)
  ./start.sh check-llm LLM_PROVIDER=openrouter LLM_MODEL=<model> LLM_API_KEY=<key>
  ./start.sh check-mae
  ./start.sh
  tail -f logs/server.log

Help for one command: ./start.sh help <command>`)
}

// One entry: ./start.sh <word> ... runs the word; anything else is a start (with the settings given as NAME=value).
const [first, ...rest] = process.argv.slice(2)
const commands = {
  stop,
  help: () => help(rest),
  '--help': () => help(rest),
  '-h': () => help(rest),
  status,
  settings,
  'check-llm': () => checkLlm(rest),
  'check-mae': () => checkMaeCommand(rest),
  update: () => update(rest),
  backup: () => backup(rest),
  query: () => query(rest),
  'init-db': () => initDb(),
  init: () => initDb(),
}
if (first !== undefined && commands[first]) await commands[first]()
else await start(first === undefined ? [] : [first, ...rest])

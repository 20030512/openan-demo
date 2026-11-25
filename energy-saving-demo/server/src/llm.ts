// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Optional LLM for the dialog's intent step (design doc 3.2.2 step 1 and 1.2). Any OpenAI-compatible
 * `/chat/completions` endpoint works, so free-tier keys from OpenRouter, Groq, Google AI Studio, DeepSeek, xAI and
 * others can be set on the Manage page. Without a key, or when a call fails, the rule-based router answers.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Db } from './db.js'
import { HttpError } from './http.js'
import { allDayRate, parseRateSegments, rateRanges, type Intent, type RateRange, type TaskParams } from './intent.js'
import { clip, explainConnection, message, since, type Explained, type TraceLog } from './trace.js'

export interface Preset {
  id: string
  name: string
  baseUrl: string
  model: string
  keyUrl: string
  /** Example model names for the dropdown; free offers change, so the field stays editable. */
  models: string[]
}

export const PRESETS: Preset[] = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', keyUrl: 'https://openrouter.ai/keys', models: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free'] },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { id: 'gemini', name: 'Google AI Studio (Gemini)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey', models: ['gemini-2.0-flash', 'gemini-1.5-flash'] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', keyUrl: 'https://platform.deepseek.com/api_keys', models: ['deepseek-chat'] },
  { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini', keyUrl: 'https://console.x.ai', models: ['grok-3-mini'] },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', keyUrl: '', models: [] },
]

export interface LlmSettings {
  enabled: boolean
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

export const EMPTY: LlmSettings = { enabled: false, provider: 'openrouter', baseUrl: PRESETS[0].baseUrl, model: PRESETS[0].model, apiKey: '' }

export function initLlmTable(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS llm_settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
}

/**
 * Settings from environment variables, used until someone saves settings on the Manage page. Unlike the database
 * on Render's free plan, they survive a restart: the provider, the base URL, the model and the key (LLM_PROVIDER, LLM_BASE_URL, LLM_MODEL
 * and the API key setting) and LLM_ENABLED=true.
 */
const KNOWN_HOSTS: Record<string, string> = { 'deepseek.com': 'deepseek', 'openrouter.ai': 'openrouter', 'groq.com': 'groq', 'generativelanguage.googleapis.com': 'gemini', 'x.ai': 'xai' }

/** LLM_PROVIDER is not needed: no address means DeepSeek, a known provider's address means that provider, any other address a server of your own. */
export function providerOf(baseUrl: string | undefined): string {
  const url = (baseUrl ?? '').trim()
  if (!url) return 'deepseek'
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  const known = Object.keys(KNOWN_HOSTS).find((h) => host === h || host.endsWith('.' + h))
  return known ? KNOWN_HOSTS[known] : 'custom'
}

export function fromEnv(): LlmSettings {
  const e = process.env
  // A model inside the network needs its address only: LLM_BASE_URL without LLM_PROVIDER means "custom", a custom server without a
  // key gets a placeholder (it ignores it), and an empty LLM_MODEL means the first model the server lists (see modelOf).
  const named = e.LLM_PROVIDER?.trim() || providerOf(e.LLM_BASE_URL)
  const preset = PRESETS.find((p) => p.id === named) ?? PRESETS[0]
  const apiKey = e.LLM_API_KEY?.trim() || (preset.id === 'custom' ? 'none' : '')
  return {
    provider: preset.id,
    baseUrl: (e.LLM_BASE_URL?.trim() || preset.baseUrl).replace(/\/+$/, ''),
    model: e.LLM_MODEL || preset.model,
    apiKey,
    enabled: e.LLM_ENABLED === 'true' && apiKey !== '',
  }
}

export function readSettings(db: Db): LlmSettings {
  const r = db.prepare('SELECT value FROM llm_settings WHERE id=1').get() as { value: string } | undefined
  if (!r) return fromEnv()
  try {
    return { ...EMPTY, ...(JSON.parse(r.value) as Partial<LlmSettings>) }
  } catch {
    return { ...EMPTY }
  }
}

export function writeSettings(db: Db, s: LlmSettings) {
  db.prepare('REPLACE INTO llm_settings VALUES(1,?)').run(JSON.stringify(s))
}

/** Only the end of a key is ever shown again. */
export const maskKey = (k: string) => (k ? `${k.slice(0, 3)}…${k.slice(-4)}` : '')

/** https only, and no address that points back into the server's own network. */
export function checkBaseUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new HttpError(400, 'baseUrl must be a full https URL')
  }
  const h = u.hostname.toLowerCase()
  const privateHost =
    h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')
  if (u.protocol !== 'https:' || privateHost || u.username || u.password) throw new HttpError(400, 'baseUrl must be an https URL with a public host name')
  return u.toString().replace(/\/+$/, '')
}

type Fetch = typeof fetch

/** Fixed settings of the AI step, read from config/llm.config.json (or the file LLM_CONFIG_FILE names). A missing or broken file means the defaults below. */
export interface LlmConfig {
  timeoutMs: number
  retries: number
  limits: { rateMbps: { min: number; max: number }; reserveBackupRatio: { min: number; max: number } }
  /** Used when the sentence gives no rate or no reserve ratio. There is no default region: a task without one is not sent. */
  defaults: { rateMbps: number; reserveBackupRatio: number }
  prompt: string
  /** The parameter prompt of step 1: the parameters of a task. Holds {userInput}. */
  paramsPrompt: string
}

const FALLBACK: LlmConfig = {
  timeoutMs: 300000,
  retries: 1,
  limits: { rateMbps: { min: 0.1, max: 100000 }, reserveBackupRatio: { min: 0, max: 100 } },
  defaults: { rateMbps: 50, reserveBackupRatio: 50 },
  prompt:
    'You route messages for an energy-saving assistant. Today is {today}. Return only JSON: {"intents":["submit-task"|"query-price"|"query-plan"|"query-both"|"unknown"],"date":"YYYY-MM-DD"}.',
  paramsPrompt: "Read the energy-saving task in the operator's message below and return its parameters as one JSON object, with nothing before or after it.\n\nThe object has three fields:\n- \"region\": the name of the region, exactly as the message writes it (text); \"\" when the message names no region (never guess one).\n- \"rateMbps\": the downlink rate the network must keep, as a list of time ranges in the order of the day: [{\"timeRange\": \"HH:MM~HH:MM\", \"target\": \"<number>Mbps\"}]. The ranges do not overlap and stay between 00:00 and 24:00. When the message gives one rate for some hours and another rate for the rest of the day, write one entry for each part of the day.\n- \"reserveBackupRatio\": the share of backup power to keep, in percent (a number from 0 to 100).\n\nExample\nMessage: 为区域 示例区 创建节能任务：0点到5点保障 10Mbps，其余时间下行速率不低于 80MBPS，备电比例保持在 40% 以上\nAnswer: {\"region\":\"示例区\",\"rateMbps\":[{\"timeRange\":\"00:00~05:00\",\"target\":\"10Mbps\"},{\"timeRange\":\"05:00~24:00\",\"target\":\"80Mbps\"}],\"reserveBackupRatio\":40}\n\nMessage: {userInput}\nAnswer:",
}

export function loadConfig(file = process.env.LLM_CONFIG_FILE || fileURLToPath(new URL('../../config/llm.config.json', import.meta.url))): LlmConfig {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<LlmConfig>
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    return {
      timeoutMs: num(j.timeoutMs, FALLBACK.timeoutMs),
      retries: Math.min(3, Math.max(0, Math.floor(num(j.retries, FALLBACK.retries)))),
      limits: {
        rateMbps: { min: num(j.limits?.rateMbps?.min, FALLBACK.limits.rateMbps.min), max: num(j.limits?.rateMbps?.max, FALLBACK.limits.rateMbps.max) },
        reserveBackupRatio: {
          min: num(j.limits?.reserveBackupRatio?.min, 0),
          max: num(j.limits?.reserveBackupRatio?.max, 100),
        },
      },
      defaults: {
        rateMbps: num(j.defaults?.rateMbps, FALLBACK.defaults.rateMbps),
        reserveBackupRatio: num(j.defaults?.reserveBackupRatio, FALLBACK.defaults.reserveBackupRatio),
      },
      prompt: typeof j.prompt === 'string' && j.prompt.includes('{today}') ? j.prompt : FALLBACK.prompt,
      paramsPrompt: typeof j.paramsPrompt === 'string' && j.paramsPrompt.includes('{userInput}') ? j.paramsPrompt : FALLBACK.paramsPrompt,
    }
  } catch {
    return FALLBACK
  }
}

export const CONFIG = loadConfig()

/** LLM_REASONING_EFFORT: low, medium or high; empty or "off" means the model answers at once. */
const effortOf = () => {
  const e = process.env.LLM_REASONING_EFFORT?.trim().toLowerCase()
  return e && e !== 'off' && e !== 'none' ? e : undefined
}

/**
 * The body of a call. With LLM_REASONING_EFFORT (low, medium or high) the model thinks before it answers: the effort is sent as
 * reasoning_effort (DeepSeek also wants thinking enabled), the temperature is left to the provider, and more tokens are allowed,
 * since the thinking counts in them.
 */
/** LLM_TEMPERATURE and LLM_MAX_TOKENS: a number, or empty for the built-in value. Some models accept only a temperature above 0 or need more room to think. */
const envNumber = (name: string): number | undefined => {
  const v = process.env[name]?.trim()
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

function requestBody(s: LlmSettings, messages: { role: string; content: string }[]) {
  const effort = effortOf()
  const temperature = envNumber('LLM_TEMPERATURE')
  const maxTokens = envNumber('LLM_MAX_TOKENS')
  // No effort: the model answers at once. DeepSeek V4 may think by default, so thinking is switched off for it explicitly.
  if (!effort) return { model: s.model, messages, temperature: temperature ?? 0, max_tokens: maxTokens ?? 300, ...(s.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) }
  return {
    model: s.model,
    messages,
    reasoning_effort: effort,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(s.provider === 'deepseek' ? { thinking: { type: 'enabled' } } : {}),
    max_tokens: maxTokens ?? 4000,
  }
}

/** The server answered 200, but not with JSON: a web page, a login page of a gateway, or another service on that address. */
class NotJsonError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super('provider answer is not JSON')
  }
}

/** The provider refused or failed the call. `status` decides whether a second try can help. */
class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`provider answered ${status}${reason ? `: ${reason}` : ''}`)
  }
  /** A wrong key, model name or request does not get better by asking again; a busy or slow provider might. */
  get final() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429
  }
}

/** The short reason out of the error body ({"error":{"message":"..."}}), else the start of the text; the key is never in it. */
function reasonOf(text: string, key: string): string {
  let reason = text
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown; metadata?: { raw?: unknown; provider_name?: unknown } } | string; message?: unknown }
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message)
    if (typeof m === 'string') reason = m
    // OpenRouter: "Provider returned error" alone says nothing; the provider behind it and its own words are in metadata.
    const meta = typeof j.error === 'object' ? j.error?.metadata : undefined
    const raw = typeof meta?.raw === 'string' ? meta.raw : undefined
    const by = typeof meta?.provider_name === 'string' ? meta.provider_name : undefined
    if (raw || by) reason += ` (${[by, raw].filter(Boolean).join(': ')})`
  } catch {
    /* not JSON: keep the text */
  }
  return reason.split(key).join('***').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Where a call is logged and what it is for ("routing", "task parameters"); `input` is the sentence of the user. */
interface Trace {
  log: Log
  purpose: string
  input?: string
}

// How long to wait for an answer, in milliseconds: LLM_TIMEOUT_SECONDS (seconds, above 0), else the config file (5 minutes: a model on a CPU,
// or loading for the first time, needs long); a model that thinks first gets 60 s at least.
const defaultTimeout = () => {
  const seconds = envNumber('LLM_TIMEOUT_SECONDS')
  if (seconds !== undefined && seconds > 0) return Math.round(seconds * 1000)
  return effortOf() ? Math.max(CONFIG.timeoutMs, 60000) : CONFIG.timeoutMs
}

/** The name of the model could not be found out: LLM_MODEL is empty and the server did not list one. */
class NoModelError extends Error {
  constructor(readonly baseUrl: string) {
    super('no model name')
  }
}

const listed = new Map<string, string>()

/** LLM_MODEL when it is set, else the first model the server lists at <base>/models (a server of one model, as inside a network). */
async function modelOf(s: LlmSettings, doFetch: Fetch, timeoutMs: number): Promise<string> {
  if (s.model) return s.model
  const known = listed.get(s.baseUrl)
  if (known) return known
  // A refused connection or a timeout is not caught here: it is explained as what it is, not as a missing model name.
  const res = await doFetch(`${s.baseUrl}/models`, { headers: s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) })
  const list = (await res.json().catch(() => undefined)) as { data?: { id?: unknown }[] } | undefined
  const id = list?.data?.find((m) => typeof m.id === 'string')?.id as string | undefined
  if (!id) throw new NoModelError(s.baseUrl)
  listed.set(s.baseUrl, id)
  return id
}

async function chat(s: LlmSettings, messages: { role: string; content: string }[], doFetch: Fetch, timeoutMs = defaultTimeout(), trace?: Trace): Promise<string> {
  const t0 = Date.now()
  if (!s.model) s = { ...s, model: await modelOf(s, doFetch, timeoutMs) }
  const body = requestBody(s, messages)
  // What goes out: the sentence, the size of the prompt and the answer limit (a limit that is too small cuts a model that thinks aloud).
  // The key is in a header and is never part of the log.
  if (trace) {
    const all = messages.map((m) => m.content).join('\n')
    trace.log.info(
      { logger: 'llm' },
      message(
        'LLM request',
        { purpose: trace.purpose, provider: s.provider, model: s.model, prompt_lines: all.split('\n').length, prompt_chars: all.length, max_tokens: (body as { max_tokens: number }).max_tokens, reasoning_effort: effortOf() ?? 'none' },
        { input: clip((trace.input ?? messages[messages.length - 1].content).trim(), 600) },
      ),
    )
    trace.log.info({ logger: 'llm' }, message('LLM request payload', { purpose: trace.purpose, method: 'POST', url: `${s.baseUrl}/chat/completions` }, { body: clip(JSON.stringify(body), 6000) }))
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await doFetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (!res.ok) {
      throw new ProviderError(res.status, reasonOf(await res.text().catch(() => ''), s.apiKey))
    }
    const raw = await res.text()
    trace?.log.info({ logger: 'llm' }, message('LLM response payload', { purpose: trace.purpose, status: res.status }, { body: clip(raw, 4000) }))
    let j: { choices?: { message?: { content?: string } }[] }
    try {
      j = JSON.parse(raw)
    } catch {
      throw new NotJsonError(res.status, raw)
    }
    // Some servers answer 200 and put the error in the body: {"error": {...}} or {"base_resp": {"status_code": 1004, "status_msg": "..."}}.
    const answer = j as { error?: { message?: string } | string; base_resp?: { status_code?: number; status_msg?: string } }
    const failure = typeof answer.error === 'string' ? answer.error : answer.error?.message ?? (answer.base_resp?.status_code ? `${answer.base_resp.status_code} ${answer.base_resp.status_msg ?? ''}`.trim() : undefined)
    if (failure) throw new ProviderError(res.status, reasonOf(JSON.stringify({ error: { message: failure } }), s.apiKey))
    const raw0 = j.choices?.[0]?.message?.content
    if (typeof raw0 !== 'string') throw new Error('provider answer has no message')
    // Models that think aloud put the thinking in <think>...</think> before the answer; only the answer is read.
    const out = raw0.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '')
    trace?.log.info({ logger: 'llm' }, message('LLM response', { purpose: trace.purpose, duration_ms: since(t0), chars: out.length }, { answer: out.trim() === '' ? '(empty)' : clip(out.trim(), 2000) }))
    return out
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A failed call in words: what happened, what it means, what to do. 429 and "Provider returned error" alone say nothing, so each
 * status and each kind of network failure gets its own explanation.
 */
export function explainLlmError(e: unknown, s: LlmSettings, timeoutMs: number): Explained {
  if (e instanceof ProviderError) {
    const st = e.status
    const said = e.reason ? ` The provider says: "${e.reason}".` : ''
    if (st === 401 || st === 403) {
      return { what: `the API key was refused (HTTP ${st})`, meaning: `The key is wrong, expired, has no access to this model, or belongs to another provider than LLM_PROVIDER=${s.provider}.${said}`, fix: './start.sh LLM_API_KEY=<key>   then test: ./start.sh check-llm' }
    }
    if (st === 402) return { what: 'no credit left (HTTP 402)', meaning: `The account at ${s.provider} has no credit for this model.${said}`, fix: 'add credit at the provider, or use a free model (OpenRouter: a name ending in :free)' }
    if (st === 404) {
      const url = `${s.baseUrl}/chat/completions`
      return {
        what: 'model not found (HTTP 404), or the address has no chat API',
        meaning: `The app called ${url}. Either the model "${s.model}" does not exist at ${s.provider}, or that address has no chat API: a server of your own usually needs /v1 at the end of LLM_BASE_URL (http://<host>:<port>/v1), or another path of its own.${said}`,
        fix: 'check LLM_BASE_URL (the app adds /chat/completions to it) and the model name the server lists (./start.sh LLM_MODEL=<id>), then ./start.sh check-llm',
      }
    }
    if (st === 408) return { what: 'the provider timed out (HTTP 408)', meaning: `The provider did not finish in time.${said}`, fix: 'try again, or use a faster model' }
    if (st === 429) {
      return {
        what: 'too many requests or the model is busy (HTTP 429)',
        meaning: `The provider limits how often this key or this model may be called, or the model is overloaded at the provider ("Provider returned error" is its short way to say so). Free models (OpenRouter: names ending in :free) have small per-minute and per-day limits and are often busy. Your settings are not the problem.${said}`,
        fix: 'wait a minute and ask again, or use another model or a paid one (./start.sh LLM_MODEL=<id>)',
      }
    }
    if (st === 400 || st === 422) {
      return { what: `the request was refused (HTTP ${st})`, meaning: `Usually a wrong model id, or the model does not accept a setting we send (LLM_REASONING_EFFORT, or a temperature of 0).${said}`, fix: 'try ./start.sh LLM_REASONING_EFFORT= (empty), or ./start.sh LLM_TEMPERATURE=0.1 (some models accept only above 0), or check the model id' }
    }
    if (st >= 500) return { what: `the provider failed (HTTP ${st})`, meaning: `An error at the provider, not in your settings.${said}`, fix: 'try again later, or use another model or provider' }
    return { what: `unexpected answer (HTTP ${st})`, meaning: `The provider answered with a status we do not know.${said}`, fix: 'run ./start.sh check-llm and read the message' }
  }
  if (e instanceof NoModelError) {
    return {
      what: 'no model name',
      meaning: `LLM_MODEL is empty and ${e.baseUrl}/models did not list a model, so the app cannot tell which model to ask.`,
      fix: './start.sh LLM_MODEL=<model name>   (the name the server uses), then ./start.sh check-llm',
    }
  }
  if (e instanceof NotJsonError) {
    return {
      what: 'the server answered, but not with an LLM answer',
      meaning: `${s.baseUrl}/chat/completions gave HTTP ${e.status} with text that is not JSON; it starts: "${clip(e.body.replace(/s+/g, ' '), 120)}". Usually another service or a web page answers at that address (a gateway, a proxy login page, a wrong port or path).`,
      fix: 'check LLM_BASE_URL (host, port and the /v1 part) and that the model server is the one listening there, then ./start.sh check-llm',
    }
  }
  if ((e as Error)?.message === 'provider answer has no message') {
    return { what: 'the provider answered without any text', meaning: 'The model produced nothing. A model that thinks first can use its whole answer limit for thinking.', fix: './start.sh LLM_REASONING_EFFORT=low (raises the limit to 4000 tokens), or use another model' }
  }
  const c = explainConnection(e, s.baseUrl, timeoutMs)
  // A timeout is its own cause: the server did not fail, it did not answer in time (a model on a CPU, or loading, can need minutes).
  if ((e as Error)?.name === 'AbortError' || (e as Error)?.name === 'TimeoutError' || c.what.startsWith('no answer within')) {
    const secs = Math.round(timeoutMs / 100) / 10
    return {
      what: c.what,
      meaning: `The app waited ${secs} s for ${s.baseUrl} and no answer came. A connection that is refused or an address that does not exist fails at once; a wait that runs out means the server took too long: a model on a CPU, or one that is still loading, can need minutes.`,
      fix: `./start.sh LLM_TIMEOUT_SECONDS=<seconds> (now ${secs}), then ./start.sh check-llm; the address itself can be tested with: curl ${s.baseUrl}/models`,
    }
  }
  return { what: c.what, meaning: c.meaning, fix: `check that this machine can reach ${s.baseUrl} (internet or proxy, or LLM_BASE_URL for a model inside the network), then ./start.sh check-llm` }
}

/** The answer came, but holds no usable JSON: say how it looks and what helps. */
export function explainUnusable(out: string): Explained {
  const text = out.trim()
  if (!text) return { what: 'the answer is empty', meaning: 'The model answered with no text. A model that thinks first can use its whole answer limit for thinking.', fix: './start.sh LLM_REASONING_EFFORT=low, or use another model' }
  if (!text.includes('{')) {
    return {
      what: 'the answer has no JSON',
      meaning: `The model wrote ${text.length} characters of text instead of JSON; it starts: "${clip(text.replace(/\s+/g, ' '), 120)}". It did not follow "return only JSON", which models that think aloud often do; the answer limit may also have cut it off before the JSON.`,
      fix: './start.sh LLM_REASONING_EFFORT=low (raises the limit to 4000 tokens), or use another model',
    }
  }
  return { what: 'the JSON in the answer is not readable', meaning: `A { } part is there but it is not what the prompt asked for; the answer starts: "${clip(text.replace(/\s+/g, ' '), 120)}".`, fix: 'use another model, or look at the full answer with LOG_LEVEL=debug' }
}

export async function testSettings(s: LlmSettings, doFetch: Fetch = fetch) {
  const t0 = Date.now()
  try {
    const reply = await chat(s, [{ role: 'user', content: 'Reply with the single word OK.' }], doFetch)
    return { ok: true as const, ms: Date.now() - t0, reply: reply.trim().slice(0, 80) }
  } catch (e) {
    const m = (e as Error).name === 'AbortError' ? `timed out after ${Math.round(defaultTimeout() / 1000)} s` : (e as Error).message
    // `hint` says what the error means and what to do; `error` stays the short technical text.
    const why = explainLlmError(e, s, defaultTimeout())
    return { ok: false as const, ms: Date.now() - t0, error: m, hint: `${why.meaning} Fix: ${why.fix}` }
  }
}

export interface LlmRoute {
  /** The first action, kept for callers that need one. */
  intent: Intent
  /** Every action to run, in order. */
  intents: Intent[]
  date?: string
}

const INTENTS: Intent[] = ['submit-task', 'query-price', 'query-plan', 'query-both', 'unknown']
const inRange = (v: number, r: { min: number; max: number }) => Number.isFinite(v) && v >= r.min && v <= r.max

/**
 * Step 1 of the skill: the parameter prompt asks the model for region, rateMbps and reserveBackupRatio.
 * The answer is read tolerantly: the design's own example writes rateMbps as segments without quotes, {00:00~06:00,2Mbps}, which
 * is not JSON, so the three fields are picked out one by one. Null when nothing usable came back (the rules take over).
 */
/** A number, also when written as text: 40, "40", "40%", "60Mbps". NaN otherwise. */
const numberOf = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*(%|mbps)?\s*$/i.test(v) ? parseFloat(v) : NaN)

export function readTaskParams(out: string, onDefault?: (field: string, given: unknown) => void): TaskParams | null {
  // Input: the answer of the model, which may arrive as the text of a JSON string with escaped quotes,
  //   {\"region\":\"REGION-A\",\"rateMbps\":[{\"timeRange\":\" 00:00~06:00\",\"target\":\"2Mbps\"},{\"timeRange\":\"06:00~24:00\",\"target\":\"50Mbps\"}],\"reserveBackupRatio\":50}
  // Output: the parameters, which as JSON are
  //   {"region":"REGION-A","rateMbps":[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}],"reserveBackupRatio":50}
  const text = out.split('\\"').join('"')
  let j: Record<string, unknown>
  try {
    j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '') as Record<string, unknown>
  } catch {
    return null
  }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !('region' in j || 'rateMbps' in j || 'reserveBackupRatio' in j)) return null
  const ratio = numberOf(j.reserveBackupRatio)
  const segments = Array.isArray(j.rateMbps) ? parseRateSegments(j.rateMbps as RateRange[]) : []
  const single = numberOf(j.rateMbps) // a single number is one rate for the whole day
  const rateOk = segments.length > 0 && segments.every((x) => inRange(x.mbps, CONFIG.limits.rateMbps))
  const target = rateOk ? segments : allDayRate(inRange(single, CONFIG.limits.rateMbps) ? single : CONFIG.defaults.rateMbps)
  const regionOk = typeof j.region === 'string' && /^[\p{L}\p{N}_-]{1,40}$/u.test(j.region.trim())
  const ratioOk = inRange(ratio, CONFIG.limits.reserveBackupRatio)
  if (!rateOk && !inRange(single, CONFIG.limits.rateMbps)) onDefault?.('rateMbps', j.rateMbps)
  if (!ratioOk) onDefault?.('reserveBackupRatio', j.reserveBackupRatio)
  return {
    // No default region: an empty region means the sentence named none, and the task is not sent (routes/energy-saving.ts).
    region: regionOk ? (j.region as string).trim() : '',
    rateMbps: rateRanges(target),
    reserveBackupRatio: ratioOk ? ratio : CONFIG.defaults.reserveBackupRatio,
  }
}

/** The logger of the app (pino): only the methods used here. */
export type Log = TraceLog

/** Why the model gave no usable answer, in words (filled by the two functions below; the chat answers with it). */
export interface LlmOutcome {
  error?: string
}

const said = (w: Explained) => `${w.what}. ${w.meaning} Fix: ${w.fix}`

/** The record of a failed attempt: WARNING while another attempt follows, ERROR when it was the last. */
function logFailure(log: Log | undefined, purpose: string, s: LlmSettings, attempt: number, retry: boolean, t0: number, why: Explained) {
  const text = message('LLM request failed', { purpose, provider: s.provider, model: s.model, attempt: attempt + 1, duration_ms: since(t0), retry: retry ? 'yes' : 'no' }, { summary: why.what, cause: why.meaning, action: why.fix })
  if (retry) log?.warn({ logger: 'llm' }, text)
  else log?.error({ logger: 'llm' }, text)
}

/** Ask the model for the parameters of a task with the parameter prompt; null on any problem, and `outcome.error` says why. */
export async function extractParamsWithLlm(s: LlmSettings, text: string, doFetch: Fetch = fetch, log?: Log, outcome?: LlmOutcome): Promise<TaskParams | null> {
  if (!s.enabled || !s.apiKey) return null
  const timeout = defaultTimeout()
  for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
    const t0 = Date.now()
    const last = attempt >= CONFIG.retries
    try {
      const out = await chat(s, [{ role: 'user', content: CONFIG.paramsPrompt.split('{userInput}').join(text) }], doFetch, timeout, log && { log, purpose: 'task parameters', input: text })
      const params = readTaskParams(out, (field, given) =>
        log?.warn({ logger: 'llm' }, message('LLM answer is incomplete', { purpose: 'task parameters', field, given: given === undefined ? 'missing' : JSON.stringify(given), used: 'the default' })),
      )
      if (!params) {
        const why = explainUnusable(out)
        logFailure(log, 'task parameters', s, attempt, !last, t0, why)
        if (outcome) outcome.error = said(why)
        continue
      }
      return params
    } catch (e) {
      const why = explainLlmError(e, s, timeout)
      const final = e instanceof ProviderError && e.final // a wrong key or model name: asking again cannot help
      logFailure(log, 'task parameters', s, attempt, !last && !final, t0, why)
      if (outcome) outcome.error = said(why)
      if (final) break
    }
  }
  return null
}

export async function routeWithLlm(s: LlmSettings, text: string, today: string, doFetch: Fetch = fetch, log?: Log, outcome?: LlmOutcome): Promise<LlmRoute | null> {
  if (!s.enabled || !s.apiKey) {
    if (outcome) outcome.error = `The LLM is not configured: ${!s.apiKey ? 'LLM_API_KEY is empty' : 'LLM_ENABLED is not true'}. Fix: ./start.sh LLM_PROVIDER=<provider> LLM_MODEL=<model> LLM_API_KEY=<key>`
    return null
  }
  const timeout = defaultTimeout()
  for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
    const t0 = Date.now()
    const last = attempt >= CONFIG.retries
    try {
      const out = await chat(s, [{ role: 'system', content: CONFIG.prompt.replaceAll('{today}', today) }, { role: 'user', content: text }], doFetch, timeout, log && { log, purpose: 'routing', input: text })
      const m = /\{[\s\S]*\}/.exec(out)
      if (!m) {
        const why = explainUnusable(out)
        logFailure(log, 'routing', s, attempt, !last, t0, why)
        if (outcome) outcome.error = said(why)
        continue
      }
      const j = JSON.parse(m[0]) as Record<string, unknown>
      const raw = Array.isArray(j.intents) ? j.intents : j.intent !== undefined ? [j.intent] : []
      const intents = raw.filter((x): x is Intent => INTENTS.includes(x as Intent))
      if (!intents.length || intents.length !== raw.length) {
        const why: Explained = { what: 'unknown or empty action names', meaning: `The model named ${JSON.stringify(raw)}; the known actions are ${INTENTS.join(', ')}.`, fix: 'use another model, or look at the full answer with LOG_LEVEL=debug' }
        logFailure(log, 'routing', s, attempt, !last, t0, why)
        if (outcome) outcome.error = said(why)
        continue
      }
      const route: LlmRoute = { intent: intents[0], intents }
      if (typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.date) && !Number.isNaN(Date.parse(j.date))) route.date = j.date
      // The parameters of a task are read in step 1 (extractParamsWithLlm), not here.
      return route
    } catch (e) {
      const why = explainLlmError(e, s, timeout)
      const final = e instanceof ProviderError && e.final
      logFailure(log, 'routing', s, attempt, !last && !final, t0, why)
      if (outcome) outcome.error = said(why)
      if (final) break
    }
  }
  return null
}

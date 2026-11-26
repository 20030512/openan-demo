// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * LLM settings on the Manage page and the optional LLM intent step. The provider is a stub, so no network is used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkBaseUrl, maskKey, readTaskParams } from '../src/llm.js'
import { BASE, importXlsx, makeApp, post, priceRows, put, xlsx, type App } from './helpers.js'

// This file tests the settings themselves, so it starts with none (helpers.ts sets some for the other tests).
for (const k of ['LLM_ENABLED', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL']) delete process.env[k]

process.env.ADMIN_KEY = 'admin' // a test value: the server has no default admin key
const ADMIN = { 'x-admin-key': 'admin' }
const SECRET = 'sk-fake-not-a-real-key-7890'
const calls: { url: string; auth: string | null; body: { model: string; messages: { content: string }[] } }[] = []
let reply: () => Response = () => new Response('{}', { status: 500 })

const stubFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body as string) })
  return reply()
}) as unknown as typeof fetch
// The routing prompt and the parameters prompt of the server are two calls: each gets its own answer.
const byPrompt = (routing: string, params: string) => () =>
  answer(calls[calls.length - 1].body.messages[0].content.includes('Read the energy-saving task') ? params : routing)()
const answer = (content: string) => () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

let app: App
beforeAll(async () => {
  app = await makeApp(stubFetch)
  await put(app, '/api/config', { standbyDuration: 480, dischargeDuration: 240, priceGranularity: 1 })
  await importXlsx(app, await xlsx(priceRows(['2026-10-24'], () => BASE, 1)))
})
afterAll(async () => app.close())

const get = (url: string, headers: Record<string, string> = ADMIN) => app.inject({ url, headers })
const save = (b: object, headers: Record<string, string> = ADMIN) => put(app, '/api/admin/llm', b, headers)
const good = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', apiKey: SECRET, enabled: true }

describe('helpers', () => {
  it('shows only the ends of a key', () => {
    expect(maskKey(SECRET)).toBe('sk-…7890')
    expect(maskKey('')).toBe('')
  })
  it.each(['http://api.example.com', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://192.0.2.5', 'https://x.internal', 'https://u:p@api.example.com', 'nope', 'https://[::1]/'])(
    'refuses base URL %s',
    (u) => expect(() => checkBaseUrl(u)).toThrow(),
  )
  it('accepts a public https URL and drops a trailing slash', () => expect(checkBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1'))
})

describe('GET/PUT /api/admin/llm', () => {
  it('needs the admin key', async () => {
    expect((await get('/api/admin/llm', {})).statusCode).toBe(401)
    expect((await get('/api/admin/llm', { 'x-admin-key': 'wrong' })).statusCode).toBe(401)
    expect((await save(good, {})).statusCode).toBe(401)
    expect((await post(app, '/api/admin/llm/test', {}, {})).statusCode).toBe(401)
  })
  it('starts switched off, with presets for the free providers', async () => {
    const j = (await get('/api/admin/llm')).json()
    expect(j.settings).toMatchObject({ enabled: false, hasKey: false })
    expect(j.presets.map((p: { id: string }) => p.id)).toEqual(['openrouter', 'groq', 'gemini', 'deepseek', 'xai', 'custom'])
  })
  it('saves settings and never returns the key', async () => {
    const r = await save(good)
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ enabled: true, hasKey: true, keyHint: 'sk-…7890', provider: 'openrouter' })
    expect(JSON.stringify(r.json())).not.toContain(SECRET)
    expect(JSON.stringify((await get('/api/admin/llm')).json())).not.toContain(SECRET)
  })
  it('keeps the saved key when the key field is left out', async () => {
    const r = await save({ ...good, apiKey: undefined, model: 'other/model:free' })
    expect(r.json()).toMatchObject({ hasKey: true, model: 'other/model:free' })
  })
  it.each([
    [{ ...good, provider: 'nope' }],
    [{ ...good, model: '' }],
    [{ ...good, model: 'bad model!' }],
    [{ ...good, baseUrl: 'http://api.example.com' }],
    [{ ...good, apiKey: 'two words' }],
    [{ ...good, baseUrl: undefined }],
  ])('rejects %j', async (b) => expect((await save(b)).statusCode).toBe(400))
})

describe('test connection', () => {
  it('reports success with the provider reply', async () => {
    await save(good)
    reply = answer('OK')
    const j = (await post(app, '/api/admin/llm/test', {}, ADMIN)).json()
    expect(j).toMatchObject({ ok: true, reply: 'OK' })
    const c = calls.at(-1)!
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(c.auth).toBe(`Bearer ${SECRET}`)
  })
  it('reports a provider error without leaking the key', async () => {
    reply = () => new Response(`bad key ${SECRET}`, { status: 401 })
    const j = (await post(app, '/api/admin/llm/test', {}, ADMIN)).json()
    expect(j.ok).toBe(false)
    expect(j.error).toContain('401')
    expect(j.error).not.toContain(SECRET)
  })
})

describe('chat with the LLM', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })

  it('uses the model answer for intent and date', async () => {
    await save(good)
    reply = answer('Sure! {"intent":"query-price","date":"2026-10-24"}')
    const j = (await chat('what does power cost right now')).json()
    expect(j).toMatchObject({ intent: 'query-price', engine: 'llm', day: '2026-10-24' })
    expect(j.prices).toHaveLength(24)
  })
  it('uses model task parameters', async () => {
    reply = answer('{"intent":"submit-task","region":"REGION-B","rateMbps":80,"reserveBackupRatio":30}')
    const j = (await chat('set something up')).json()
    expect(j).toMatchObject({ intent: 'submit-task', engine: 'llm', params: { region: 'REGION-B', rateMbps: [{"timeRange":"00:00~24:00","target":"80Mbps"}], reserveBackupRatio: 30 } })
  })
  it('a failing provider or an unusable answer is an error with the reason, never a silent fallback', async () => {
    const cases: [() => Response, string][] = [
      [() => new Response('x', { status: 500 }), 'the provider failed (HTTP 500)'],
      [answer('not json'), 'the answer has no JSON'],
      [answer('{"intent":"delete-all"}'), 'unknown or empty action names'],
    ]
    for (const [r, text] of cases) {
      reply = r
      const res = await chat("Query today's dynamic electricity price")
      expect(res.statusCode).toBe(502)
      expect(res.json().detail).toContain(text)
      expect(res.json().detail).toContain('Fix:')
    }
  })
  it('does not call the provider when switched off: the request fails and says how to set it', async () => {
    await save({ ...good, enabled: false })
    const n = calls.length
    const res = await chat('price today')
    expect(res.statusCode).toBe(503)
    expect(res.json().detail).toContain('The LLM is not configured')
    expect(res.json().detail).toContain('./start.sh LLM_PROVIDER')
    expect(calls.length).toBe(n)
  })
  it('refuses to switch on without a key, and a cleared key switches it off', async () => {
    await save({ ...good, apiKey: '', enabled: false })
    expect((await get('/api/admin/llm')).json().settings.hasKey).toBe(false)
    expect((await save({ ...good, apiKey: undefined, enabled: true })).statusCode).toBe(400)
  })
})

describe('settings from environment variables', () => {
  it('are used until settings are saved, and a saved row wins', async () => {
    const keep = { ...process.env }
    process.env.LLM_PROVIDER = 'groq'
    process.env.LLM_API_KEY = 'made-up-env-key'
    process.env.LLM_ENABLED = 'true'
    try {
      const fresh = await makeApp(stubFetch)
      const j = (await fresh.inject({ url: '/api/admin/llm', headers: ADMIN })).json()
      expect(j.settings).toMatchObject({ provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true, hasKey: true })
      expect(JSON.stringify(j)).not.toContain('made-up-env-key')
      await put(fresh, '/api/admin/llm', { ...good, enabled: false }, ADMIN)
      expect((await fresh.inject({ url: '/api/admin/llm', headers: ADMIN })).json().settings).toMatchObject({ provider: 'openrouter', enabled: false })
      await fresh.close()
    } finally {
      for (const k of ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_ENABLED']) delete process.env[k]
      Object.assign(process.env, keep)
    }
  })
  it('stay off without a key', async () => {
    process.env.LLM_ENABLED = 'true'
    try {
      const fresh = await makeApp(stubFetch)
      expect((await fresh.inject({ url: '/api/admin/llm', headers: ADMIN })).json().settings).toMatchObject({ enabled: false, hasKey: false })
      await fresh.close()
    } finally {
      delete process.env.LLM_ENABLED
    }
  })
})

describe('chat with the LLM: several actions, retry and limits', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })
  it('uses a list of actions from the model', async () => {
    await save(good)
    reply = answer('{"intents":["submit-task","query-both"],"date":"2026-10-24","region":"REGION-B","rateMbps":80,"reserveBackupRatio":30}')
    const j = (await chat('do the thing')).json()
    expect(j.engine).toBe('llm')
    expect(j.actions.map((a: { intent: string }) => a.intent)).toEqual(['submit-task', 'query-both'])
    expect(j.actions[0].params).toEqual({ region: 'REGION-B', rateMbps: [{"timeRange":"00:00~24:00","target":"80Mbps"}], reserveBackupRatio: 30 })
  })
  it('retries once when the first answer is bad, then succeeds', async () => {
    const answers = [() => new Response('x', { status: 500 }), answer('{"intents":["query-price"],"date":"2026-10-24"}')]
    reply = () => answers.shift()!()
    const n = calls.length
    const j = (await chat('what does power cost')).json()
    expect(j).toMatchObject({ engine: 'llm', intent: 'query-price' })
    expect(calls.length - n).toBe(2)
  })
  it('values outside the configured limits fall back to the defaults', async () => {
    reply = answer('{"intents":["submit-task"],"region":"REGION-A","rateMbps":-5,"reserveBackupRatio":150}')
    const j = (await chat('set something up')).json()
    expect(j.actions[0].params).toEqual({ region: 'REGION-A', rateMbps: [{"timeRange":"00:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 }, { batchId: 1, strategies: [] })
  })
  it('an unknown action name makes the model answer unusable: the request fails with the reason', async () => {
    reply = answer('{"intents":["delete-all"]}')
    const res = await chat("Query today's dynamic electricity price")
    expect(res.statusCode).toBe(502)
    expect(res.json().detail).toContain('unknown or empty action names')
  })
})

describe('step 1 with the parameter prompt', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })
  const SENTENCE = "在区域REGION-B创建节能任务，闲时0~6点速率保障目标2Mbps，非闲时需要保障下行速率不低于50MBPS。允许启动基于动态电价的锂电充放电节电费功能，并保证预留备电电量比例不低于50%"
  let before = 0
  beforeAll(async () => {
    await save(good)
  })

  it('sends the parameter prompt with the sentence in it, as one message', async () => {
    before = calls.length
    reply = (() => {
      let n = 0
      return () => (n++ === 0 ? answer('{"intents":["submit-task"]}')() : answer('{"region":"REGION-B","rateMbps":[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}],"reserveBackupRatio":50}')())
    })()
    const j = (await chat(SENTENCE)).json()
    const sent = calls.slice(before).map((c) => c.body.messages.map((m) => m.content).join('\n'))
    const paramsCall = sent.find((x) => x.includes('Read the energy-saving task'))!
    expect(paramsCall).toContain('Message: ' + SENTENCE + '\nAnswer:')
    expect(paramsCall).toContain('"rateMbps": the downlink rate the network must keep')
    expect(paramsCall).not.toContain('{userInput}')
    expect(j.engine).toBe('llm')
    expect(j.params).toEqual({
      region: 'REGION-B',
      rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], // the time segments of the answer, as text
      reserveBackupRatio: 50,
    })
  })

  it('the Task-T text then carries the segments of the model', async () => {
    const { buildTaskT } = await import('../src/skills/energy-saving/task-template-builder.js')
    const text = buildTaskT({ region: 'REGION-B', rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 })
    expect(text).toContain('Time-segment-based guaranteed throughput target: {00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}')
    expect(text).toContain('in the REGION-B region: {00:00–06:00, 2Mbps}, and {06:00–24:00, 50Mbps}, output')
  })

  it('reads the answer in the form {"timeRange":"00:00~06:00","target":"2Mbps"}, also when it arrives with escaped quotes', async () => {
    const escaped = '{\\"region\\":\\"REGION-A\\",\\"rateMbps\\":[{\\"timeRange\\":\\"00:00~06:00\\",\\"target\\":\\"2Mbps\\"},{\\"timeRange\\":\\"06:00~24:00\\",\\"target\\":\\"50Mbps\\"}],\\"reserveBackupRatio\\":50}'
    const want = { region: 'REGION-A', rateMbps: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 }
    // input as the model wrote it into a JSON string, output as JSON text, with the escapes taken out
    expect(JSON.stringify(readTaskParams(escaped))).toBe('{"region":"REGION-A","rateMbps":[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}],"reserveBackupRatio":50}')
    expect(readTaskParams(escaped)).toEqual(want)
    expect(readTaskParams(escaped.split('\\"').join('"'))).toEqual(want) // the same text, unescaped
    reply = byPrompt('{"intents":["submit-task"]}', escaped)
    expect((await chat(SENTENCE)).json().actions[0].params).toEqual(want)
  })

  it('reads an answer written as plain JSON too, and a Chinese region', async () => {
    reply = byPrompt('{"intents":["submit-task"]}', '{"region":"REGION-A","rateMbps":80,"reserveBackupRatio":30}')
    const j = (await chat(SENTENCE)).json()
    expect(j.actions[0].params).toEqual({ region: 'REGION-A', rateMbps: [{"timeRange":"00:00~24:00","target":"80Mbps"}], reserveBackupRatio: 30 }) // a single number becomes the four fixed segments
  })

  it('values outside the limits, or segments that overlap, give the defaults / no segments', async () => {
    reply = byPrompt('{"intents":["submit-task"]}', '{"region":"A","rateMbps":[{"timeRange":"00:00~08:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}],"reserveBackupRatio":500}')
    const j = (await chat(SENTENCE)).json()
    expect(j.actions[0].params).toEqual({ region: 'A', rateMbps: [{"timeRange":"00:00~24:00","target":"50Mbps"}], reserveBackupRatio: 50 })
  })

  it('nothing usable for the parameters is an error that says how the answer looked (no silent fallback)', async () => {
    reply = byPrompt('{"intents":["submit-task"]}', 'sorry, no')
    const res = await chat("Create an energy-saving task in region REGION-T; idle hours 0~6 o'clock rate guarantee target 2Mbps; non-idle at least 50Mbps, reserve 40%")
    expect(res.statusCode).toBe(502)
    expect(res.json().detail).toContain('the answer has no JSON')
    expect(res.json().detail).toContain('sorry, no')
  })
})

describe('provider errors', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })
  it('the reason is the message of the provider, short, and a wrong model name is not asked twice', async () => {
    await save(good)
    const n0 = calls.length
    reply = () => new Response('{"error":{"message":"This model is unavailable for free. Use this slug instead: meta-llama/llama-3.3-70b-instruct","code":404},"user_id":"user_secret"}', { status: 404 })
    const res = await chat("what does power cost right now")
    expect(res.statusCode).toBe(502)
    expect(res.json().detail).toContain('model not found (HTTP 404)')
    expect(calls.length - n0).toBe(1) // 404 is final: one call for the routing, no retry
    const t = await post(app, '/api/admin/llm/test', {}, ADMIN)
    expect(t.json()).toMatchObject({ ok: false, error: 'provider answered 404: This model is unavailable for free. Use this slug instead: meta-llama/llama-3.3-70b-instruct' })
    expect(JSON.stringify(t.json())).not.toContain('user_secret')
  })
  it('a busy provider (429) or a server error (500) is asked again once', async () => {
    const n0 = calls.length
    reply = () => new Response('{"error":{"message":"rate limited"}}', { status: 429 })
    await chat("what does power cost right now")
    expect(calls.length - n0).toBe(2)
  })
})

describe('reasoning effort (LLM_REASONING_EFFORT)', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })
  it('is off by default: temperature 0, 300 tokens, no reasoning fields', async () => {
    await save(good)
    reply = answer('{"intents":["query-price"],"date":"2026-10-24"}')
    const n0 = calls.length
    await chat('what does power cost right now')
    expect(calls[n0].body).toMatchObject({ temperature: 0, max_tokens: 300 })
    expect(calls[n0].body).not.toHaveProperty('reasoning_effort')
  })
  it('DeepSeek: thinking is switched off explicitly when no effort is set', async () => {
    reply = answer('{"intents":["query-price"],"date":"2026-10-24"}')
    await save({ ...good, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' })
    const n0 = calls.length
    await chat('what does power cost right now')
    expect(calls[n0].body).toMatchObject({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0, max_tokens: 300 })
    expect(calls[n0].body).not.toHaveProperty('reasoning_effort')
    await save(good)
  })
  it('is sent when set, with thinking enabled for DeepSeek only', async () => {
    process.env.LLM_REASONING_EFFORT = 'medium'
    try {
      reply = answer('{"intents":["query-price"],"date":"2026-10-24"}')
      await save({ ...good, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' })
      let n0 = calls.length
      await chat('what does power cost right now')
      expect(calls[n0].body).toMatchObject({ model: 'deepseek-v4-flash', reasoning_effort: 'medium', thinking: { type: 'enabled' }, max_tokens: 4000 })
      expect(calls[n0].body).not.toHaveProperty('temperature')
      await save(good) // another provider: the effort goes, the DeepSeek-only field does not
      n0 = calls.length
      await chat('what does power cost right now')
      expect(calls[n0].body).toMatchObject({ reasoning_effort: 'medium' })
      expect(calls[n0].body).not.toHaveProperty('thinking')
    } finally {
      delete process.env.LLM_REASONING_EFFORT
    }
  })
})

describe('readTaskParams keeps the values of the model in the forms a model may write them', () => {
  const want = { region: 'test', rateMbps: [{ timeRange: '00:00~06:00', target: '2Mbps' }, { timeRange: '06:00~24:00', target: '60Mbps' }], reserveBackupRatio: 40 }
  it.each([
    ['hours without minutes and a ratio as text', '{"region":"test","rateMbps":[{"timeRange":"0~6","target":"2Mbps"},{"timeRange":"6~24","target":"60Mbps"}],"reserveBackupRatio":"40%"}'],
    ['dashes, spaces and capitals', '{"region":"test","rateMbps":[{"timeRange":"00:00-06:00","target":"2 Mbps"},{"timeRange":"06:00-24:00","target":"60MBPS"}],"reserveBackupRatio":"40"}'],
  ])('%s', (_n, answer) => expect(readTaskParams(answer)).toEqual(want))
  it('a single rate as text is one range for the whole day', () => {
    expect(readTaskParams('{"region":"test","rateMbps":"60","reserveBackupRatio":40}')?.rateMbps).toEqual([{ timeRange: '00:00~24:00', target: '60Mbps' }])
  })
  it('names each field that falls back to a default', () => {
    const fell: string[] = []
    readTaskParams('{"region":"test"}', (field) => fell.push(field))
    expect(fell).toEqual(['rateMbps', 'reserveBackupRatio'])
  })
})

describe('the chat says why the model gave no answer', () => {
  const chat = (message: string) => post(app, '/api/energy-saving/chat', { message, today: '2026-10-24' })
  beforeAll(async () => {
    await save(good)
  })

  it('a 429 of the provider is an error with the meaning and the fix, not a silent fallback', async () => {
    reply = () => new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 429 } }), { status: 429 })
    const res = await chat("Query today's dynamic electricity price")
    expect(res.statusCode).toBe(502)
    expect(res.json().detail).toContain('too many requests or the model is busy (HTTP 429)')
    expect(res.json().detail).toContain('Free models')
    expect(res.json().detail).toContain('Fix:')
  })
  it('a model that answers has no note', async () => {
    reply = answer('{"intents":["query-price"],"date":"2026-10-24"}')
    const j = (await chat('what does power cost')).json()
    expect(j.engine).toBe('llm')
    expect(j).not.toHaveProperty('llmNote')
  })
  it('a text answer without JSON for the parameters is an error and the task is not sent', async () => {
    // The routing prompt gets JSON, the parameter prompt (it starts with "Read the energy-saving task") gets talk.
    reply = byPrompt('{"intents":["submit-task"]}', 'The user wants me to extract three parameters from the input')
    const res = await chat('Create an energy-saving task in region REGION-A, downlink not lower than 30Mbps')
    expect(res.statusCode).toBe(502)
    expect(res.json().detail).toContain('no JSON')
    expect(res.json().detail).toContain('The user wants me to extract')
  })
})

describe('the cause of "not configured" is the missing key first', () => {
  it('says LLM_API_KEY is empty when there is no key, and LLM_ENABLED when there is a key but it is off', async () => {
    await save({ ...good, apiKey: '', enabled: false })
    const none = await post(app, '/api/energy-saving/chat', { message: 'price today', today: '2026-10-24' })
    expect(none.statusCode).toBe(503)
    expect(none.json().detail).toContain('LLM_API_KEY is empty')
    await save(good)
    await save({ ...good, enabled: false })
    const off = await post(app, '/api/energy-saving/chat', { message: 'price today', today: '2026-10-24' })
    expect(off.json().detail).toContain('LLM_ENABLED is not true')
    await save(good)
  })
})

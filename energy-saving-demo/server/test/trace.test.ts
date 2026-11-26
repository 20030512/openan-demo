// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The log of the server (trace.ts, logging.ts): the layout of the A2A projects, `YYYY-MM-DD HH:mm:ss - logger - LEVEL - message`.
 * What goes to the LLM and to the Network Agent is written as plain records, a failure says what it means and what to do, and no key,
 * password or token is ever written in full.
 */
import { describe, expect, it } from 'vitest'
import { formatRecord, pythonStyleLogger, stamp } from '../src/logging.js'
import { explainLlmError, explainUnusable, extractParamsWithLlm, routeWithLlm, testSettings, type LlmOutcome, type LlmSettings } from '../src/llm.js'
import { openDb } from '../src/db.js'
import { A2AClient } from '../src/skills/energy-saving/a2a-client.js'
import { TokenClient } from '../src/skills/energy-saving/token-client.js'
import { checkMaeLogin } from '../src/startup-check.js'
import { initTaskTables } from '../src/tasks.js'
import { clip, explainConnection, explainMaeStatus, maskToken, message, ratesText } from '../src/trace.js'
import { testFixtures } from './helpers.js'
import { createMockMae } from './support/mock-mae.js'

const KEY = 'made-up-secret-key'
const s: LlmSettings = { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/model:free', apiKey: KEY, enabled: true }
const capture = () => {
  const lines: string[] = []
  const at = (level: string) => (_o: object, m: string) => void lines.push(`${level} ${m}`)
  return { lines, log: { info: at('INFO'), warn: at('WARNING'), error: at('ERROR'), debug: at('DEBUG') } }
}
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
const answer = (content: string) => reply(200, { choices: [{ message: { content } }] })

describe('the layout of a line', () => {
  it('is date time - logger - LEVEL - message, as in the A2A projects, without milliseconds and without symbols', () => {
    const t = new Date(2026, 9, 28, 5, 44, 20, 334).getTime()
    expect(stamp(t)).toBe('2026-10-28 05:44:20')
    expect(formatRecord(JSON.stringify({ time: t, level: 30, logger: 'llm', msg: 'LLM response: purpose=routing' }))).toBe('2026-10-28 05:44:20 - llm - INFO - LLM response: purpose=routing')
    expect(formatRecord(JSON.stringify({ time: t, level: 40, msg: 'x' }))).toBe('2026-10-28 05:44:20 - server - WARNING - x')
    expect(formatRecord(JSON.stringify({ time: t, level: 50, logger: 'chat', msg: 'x' }))).toContain(' - chat - ERROR - x')
    expect(formatRecord(JSON.stringify({ time: t, level: 20, msg: 'x' }))).toContain(' - DEBUG - ')
  })
  it('the logger of the server writes it', async () => {
    const out: string[] = []
    const log = pythonStyleLogger('info', { write: (s: string) => void out.push(s) })
    log.info({ logger: 'startup' }, 'Server started: port=8000')
    log.debug({ logger: 'startup' }, 'not at this level')
    await new Promise((r) => setTimeout(r, 50))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - startup - INFO - Server started: port=8000\n$/)
  })
})

describe('message', () => {
  it('is an event, its fields as key=value, and the texts on indented lines', () => {
    expect(message('LLM response', { purpose: 'routing', chars: 47, skipped: undefined }, { answer: '{"intents":[]}' })).toBe('LLM response: purpose=routing chars=47\n    answer: {"intents":[]}')
  })
  it('quotes a value with a space, indents a text of several lines, and leaves out empty texts', () => {
    expect(message('E', { a: 'two words', b: '' })).toBe('E: a="two words" b=""')
    expect(message('E', {}, { t: 'x\ny', empty: '' }).split('\n')).toEqual(['E', '    t: x', '        y'])
  })
  it('has no decoration: no arrows, no check marks', () => {
    const all = [message('LLM request failed', { a: 1 }, { cause: 'c', action: 'a' }), clip('abcdefghij', 4), maskToken('x-0ba7f3c9d1e2'), ratesText([{ timeRange: '00:00~06:00', target: '2Mbps' }])].join(' ')
    expect(all).not.toMatch(/[←-⇿✀-➿·…]/)
  })
  it('clip says how much was left out; maskToken shows six characters; ratesText is one line', () => {
    expect(clip('abcdefghij', 4)).toBe('abcd... (6 more characters)')
    expect(maskToken('x-0ba7f3c9d1e2')).toBe('x-0ba7...')
    expect(maskToken('abc')).toBe('***')
    expect(ratesText([{ timeRange: ' 00:00~06:00', target: '2Mbps' }, { timeRange: '06:00~24:00', target: '50Mbps' }])).toBe('00:00~06:00 2Mbps; 06:00~24:00 50Mbps')
  })
})

describe('the log of an LLM call', () => {
  it('writes the sentence in and the answer out, with the limit, and never the key', async () => {
    const { lines, log } = capture()
    const r = await routeWithLlm(s, 'what does power cost right now', '2026-10-27', answer('{"intents":["query-price"],"date":"2026-10-27"}'), log)
    expect(r?.intents).toEqual(['query-price'])
    const text = lines.join('\n')
    expect(text).toContain('INFO LLM request: purpose=routing provider=openrouter model=vendor/model:free')
    expect(text).toContain('max_tokens=300 reasoning_effort=none')
    expect(text).toContain('input: what does power cost right now')
    expect(text).toMatch(/INFO LLM response: purpose=routing duration_ms=\d+ chars=47/)
    expect(text).toContain('answer: {"intents":["query-price"],"date":"2026-10-27"}')
    expect(text).toContain('INFO LLM request payload: purpose=routing') // the whole request body and the raw answer are in the log
    expect(text).toContain('INFO LLM response payload: purpose=routing')
    expect(text).not.toContain(KEY)
  })

  it('429 is an ERROR with the cause, the action, and what the provider said behind "Provider returned error"', async () => {
    const { lines, log } = capture()
    const outcome: LlmOutcome = {}
    const busy = reply(429, { error: { message: 'Provider returned error', code: 429, metadata: { provider_name: 'Venice', raw: 'rate-limited upstream' } } })
    expect(await routeWithLlm(s, 'hello', '2026-10-27', busy, log, outcome)).toBeNull()
    const text = lines.join('\n')
    expect(text).toContain('WARNING LLM request failed: purpose=routing') // the first attempt: another follows
    expect(text).toContain('ERROR LLM request failed: purpose=routing provider=openrouter model=vendor/model:free attempt=2')
    expect(text).toContain('retry=no')
    expect(text).toContain('summary: too many requests or the model is busy (HTTP 429)')
    expect(text).toContain('Free models')
    expect(text).toContain('Venice: rate-limited upstream')
    expect(text).toContain('action: wait a minute')
    expect(outcome.error).toContain('too many requests')
    expect(text).not.toContain(KEY)
  })

  it('a wrong key is final: one attempt, an ERROR, and the action names the setting', async () => {
    const { lines, log } = capture()
    let calls = 0
    const f = (async () => (calls++, new Response('{"error":{"message":"No auth credentials"}}', { status: 401 }))) as unknown as typeof fetch
    await routeWithLlm(s, 'hello', '2026-10-27', f, log)
    expect(calls).toBe(1)
    const text = lines.join('\n')
    expect(text).toContain('ERROR LLM request failed')
    expect(text).toContain('the API key was refused (HTTP 401)')
    expect(text).toContain('./start.sh LLM_API_KEY=<key>')
  })

  it('a model that thinks aloud gives text without JSON: the log shows how it starts and what helps', async () => {
    const { lines, log } = capture()
    const outcome: LlmOutcome = {}
    const talk = answer('The user wants me to extract three parameters from the input text and output a JSON string. The parameters are:')
    expect(await extractParamsWithLlm(s, 'Create a task', talk, log, outcome)).toBeNull()
    const text = lines.join('\n')
    expect(text).toContain('ERROR LLM request failed: purpose="task parameters"')
    expect(text).toContain('summary: the answer has no JSON')
    expect(text).toContain('The user wants me to extract')
    expect(text).toContain('LLM_REASONING_EFFORT=low')
    expect(outcome.error).toContain('no JSON')
  })

  it('no LLM configured: no call, and the reason', async () => {
    const outcome: LlmOutcome = {}
    let calls = 0
    const f = (async () => (calls++, new Response('{}'))) as unknown as typeof fetch
    expect(await routeWithLlm({ ...s, apiKey: '' }, 'x', '2026-10-27', f, undefined, outcome)).toBeNull()
    expect(calls).toBe(0)
    expect(outcome.error).toContain('The LLM is not configured: LLM_API_KEY is empty')
  })
})

describe('explanations', () => {
  const why = (e: unknown) => explainLlmError(e, s, 30000)
  const provider = async (status: number) => {
    const r = await testSettings(s, reply(status, { error: { message: 'x' } }))
    return r.ok ? '' : `${r.error} | ${r.hint}`
  }
  it('every status has its own words', async () => {
    expect(await provider(401)).toContain('wrong, expired, has no access')
    expect(await provider(402)).toContain('no credit')
    expect(await provider(404)).toContain('does not exist')
    expect(await provider(429)).toContain('limits how often')
    expect(await provider(400)).toContain('LLM_REASONING_EFFORT')
    expect(await provider(503)).toContain('not in your settings')
  })
  it('the technical error stays as it was, and the hint is added', async () => {
    const r = await testSettings(s, reply(404, { error: { message: 'No endpoints found' } }))
    expect(r).toMatchObject({ ok: false, error: 'provider answered 404: No endpoints found' })
    expect((r as { hint: string }).hint).toContain('LLM_MODEL')
  })
  it('network failures are told apart', () => {
    const fail = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
    expect(why(fail('ECONNREFUSED')).what).toBe('connection refused')
    expect(why(fail('ENOTFOUND')).what).toBe('host name not found')
    expect(why(fail('EHOSTUNREACH')).what).toBe('no route to the host')
    expect(why(Object.assign(new Error('x'), { name: 'AbortError' })).what).toContain('no answer within 30.0 s')
    expect(why(Object.assign(new Error('x'), { name: 'AbortError' })).fix).toContain('LLM_TIMEOUT_SECONDS')
    expect(why(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('all'), { errors: [{ code: 'ECONNREFUSED' }] }) })).what).toBe('connection refused')
    expect(why(new Error('provider answer has no message')).what).toContain('without any text')
    // the protocol is wrong
    const cause = (code: string, message: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) })
    expect(why(cause('HPE_INVALID_CONSTANT', 'Response does not match the HTTP/1.1 protocol (Expected HTTP/)')).what).toContain('does not speak plain http')
    expect(why(cause('ERR_SSL_WRONG_VERSION_NUMBER', 'error:0A00010B:SSL routines:wrong version number')).what).toContain('https used on a plain http port')
    expect(why(cause('', 'unknown scheme')).what).toContain('no http:// or https://')
    expect(why(Object.assign(new TypeError('Failed to parse URL from 192.0.2.1:80/x'), { cause: Object.assign(new Error('Invalid URL'), { code: 'ERR_INVALID_URL' }) })).what).toContain('no http:// or https://')
    expect(why(cause('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate')).what).toBe('certificate problem')
  })
  it('an unusable answer: empty, text without JSON, JSON that is not what was asked', () => {
    expect(explainUnusable('  ').what).toBe('the answer is empty')
    expect(explainUnusable('I think the answer is').what).toBe('the answer has no JSON')
    expect(explainUnusable('{ nope }').what).toContain('not readable')
  })
  it('MAE statuses', () => {
    expect(explainMaeStatus(401, 'login', 'u').meaning).toContain('user name or password is wrong')
    expect(explainMaeStatus(404, 'login', 'http://x/y').meaning).toContain('not a Network Agent')
    expect(explainMaeStatus(500, 'task', 'u').meaning).toContain('not your settings')
    expect(explainConnection(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 'http://x', 8000).what).toBe('connection refused')
  })
})

describe('the log of the MAE exchange', () => {
  const BASE = 'http://mae.test'
  const setup = () => {
    const db = openDb(':memory:')
    initTaskTables(db)
    testFixtures(db)
    return db
  }
  it('the login writes the user and never the password; the token is cut', async () => {
    const db = setup()
    const { lines, log } = capture()
    await new TokenClient(createMockMae(db), BASE, log).getAccessToken()
    const text = lines.join('\n')
    expect(text).toContain('INFO MAE login request: method=POST url=http://mae.test/api/rest')
    expect(text).toContain('user=demo')
    expect(text).not.toContain('demo123')
    expect(text).toMatch(/INFO MAE login response: status=200 duration_ms=\d+ token=x-[0-9a-f]{4}\.\.\. expires_s=1800/)
  })
  it('a refused login is an ERROR with the cause, the action and what the user sees', async () => {
    const db = setup()
    const { lines, log } = capture()
    await expect(new TokenClient(createMockMae(db), BASE, log, () => ({ user: 'demo', password: 'wrong' })).getAccessToken()).rejects.toThrow('Authentication failed')
    const text = lines.join('\n')
    expect(text).toContain('ERROR MAE login failed: url=http://mae.test/api/rest')
    expect(text).toContain('status=401')
    expect(text).toContain('the user name or password is wrong')
    expect(text).toContain('./start.sh check-mae')
    expect(text).toContain('user_message: Authentication failed, please check the username and password or the network connection')
    expect(text).not.toContain('wrong\n')
  })
  it('no answer from the Network Agent is told apart from a refusal', async () => {
    const db = setup()
    const { lines, log } = capture()
    const down = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as unknown as typeof fetch
    await expect(new TokenClient(down, 'http://mae.example.com:8080', log).getAccessToken()).rejects.toThrow('Authentication failed')
    expect(lines.join('\n')).toContain('summary: connection refused')
    expect(lines.join('\n')).toContain('nothing listens on that port of http://mae.example.com:8080')
  })
  it('without MAE_BASE_URL or a login the error says which setting is missing', async () => {
    const db = openDb(':memory:')
    initTaskTables(db)
    const { lines, log } = capture()
    await expect(new TokenClient(createMockMae(db), '', log).getAccessToken()).rejects.toThrow('not configured')
    expect(lines.join('\n')).toContain('MAE_BASE_URL is not set')
    await expect(new TokenClient(createMockMae(db), BASE, log, () => null).getAccessToken()).rejects.toThrow('Authentication information is not configured')
    expect(lines.join('\n')).toContain('MAE_USERNAME and MAE_PASSWORD are not set')
  })
  it('sending a task and watching it: one record each, the state only when it changes', async () => {
    const db = setup()
    const mae = createMockMae(db)
    const { accessToken } = (await (await mae(`${BASE}/api/rest/securityManagement/v1/oauth/token`, { method: 'POST', body: JSON.stringify({ grantType: 'password', userName: 'demo', value: 'demo123' }) })).json()) as { accessToken: string }
    const { lines, log } = capture()
    const a2a = new A2AClient(mae, BASE, log)
    const text = '## Task Object\nREGION-A Region\nTime-segment-based guaranteed throughput target: {00:00~24:00,50Mbps}\nReserve Backup Ratio: not lower than 50%\nEnergySaving Strategy: {"batchId":1,"strategies":[]}'
    const id = await a2a.send({ text }, accessToken)
    await a2a.getTask(id, accessToken)
    await a2a.getTask(id, accessToken)
    await a2a.getTask(id, accessToken)
    const out = lines.join('\n')
    expect(out).toContain('INFO MAE task request: operation=send_task method=POST url=http://mae.test/a2a/json/message:stream')
    expect(out).toContain(`task_t_chars=${text.length}`)
    expect(out).toContain(`task_id=${id}`)
    expect(out.match(/MAE task state:/g)).toHaveLength(1) // three reads, one record: the state did not change
    expect(out).toContain('previous=none state=SUBMITTED')
    expect(out).not.toContain(accessToken)
  })
})

describe('the check of the MAE login at start', () => {
  it('logs INFO when the login works and ERROR with the cause and the action when it does not', async () => {
    const ok = capture()
    expect(await checkMaeLogin('http://mae.test', 'u', 'p', ok.log, (async () => new Response(JSON.stringify({ accessToken: 'x-made-up-token' }))) as unknown as typeof fetch)).toBe(true)
    expect(ok.lines.join('\n')).toMatch(/INFO MAE login check succeeded: url=http:\/\/mae.test\/api\/rest\S+ user=u duration_ms=\d+/)

    const bad = capture()
    expect(await checkMaeLogin('http://mae.test', 'u', 'p', bad.log, (async () => new Response('{"error":{"message":"bad login"}}', { status: 401 })) as unknown as typeof fetch)).toBe(false)
    expect(bad.lines.join('\n')).toContain('ERROR MAE login check failed')
    expect(bad.lines.join('\n')).toContain('the user name or password is wrong')
    expect(bad.lines.join('\n')).not.toContain('p\n')

    const down = capture()
    const refused = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as unknown as typeof fetch
    expect(await checkMaeLogin('http://mae.test', 'u', 'p', down.log, refused)).toBe(false)
    expect(down.lines.join('\n')).toContain('summary: connection refused')
  })
})

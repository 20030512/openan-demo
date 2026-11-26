// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * ./start.sh refuses to start until the settings are complete, and the LLM is required (bin/preflight.mjs). Every problem
 * names the exact ./start.sh command that fixes it. The example settings file is the one the developer starts from.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript module of the control program
import { checkMae, llmLine, maeLine, maeTimeoutMs, problems, providerOf, withInternalDefaults } from '../../bin/preflight.mjs'

const root = join(import.meta.dirname, '..', '..')
const parse = (file: string) => Object.fromEntries([...readFileSync(file, 'utf8').matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]))
const shipped = parse(join(root, 'config', 'app.env.example'))
// The example plus the MAE address and login that the operator sets once: the other tests start from this.
const example = { ...shipped, MAE_BASE_URL: 'http://mae.example.com:8080', MAE_USERNAME: 'mae-user', MAE_PASSWORD: 'mae-password' }
const fixes = (env: Record<string, string>) => (problems(env) as { what: string; fix: string }[]).map((p) => p.fix)

describe('the settings a deployment needs', () => {
  it('the example file is not complete: the LLM key is missing, and the server starts anyway', () => {
    expect(example.LLM_ENABLED).toBe('true')
    expect(example).not.toHaveProperty('LLM_REQUIRED')
    expect(fixes(example)).toEqual(['./start.sh LLM_API_KEY=<key>'])
  })
  it('a provider on the internet needs only the key', () => {
    expect(problems({ ...example, LLM_API_KEY: 'sk-1' })).toEqual([])
  })
  it('a custom model needs its address; the model name and the key are optional, http is fine', () => {
    const env = { ...example, LLM_PROVIDER: 'custom', LLM_API_KEY: '', LLM_MODEL: '' }
    expect(fixes(env)).toEqual(['./start.sh LLM_BASE_URL=http://<host>:<port>/v1'])
    expect(problems({ ...env, LLM_BASE_URL: 'http://192.0.2.5:8080/v1' })).toEqual([])
    expect(problems({ ...env, LLM_BASE_URL: 'https://llm.hq.internal/v1', LLM_MODEL: 'qwen' })).toEqual([])
  })
  it('the address alone is enough for a model inside the network: no provider, no key, no model name', () => {
    const env = { ...example, LLM_PROVIDER: '', LLM_API_KEY: '', LLM_MODEL: '', LLM_BASE_URL: 'http://192.0.2.5:8080/v1' }
    expect(problems(env)).toEqual([])
    expect(withInternalDefaults(env)).toMatchObject({ LLM_PROVIDER: 'custom', LLM_API_KEY: 'none' })
    expect(llmLine(env)).toContain('custom / (the first model the server lists) at http://192.0.2.5:8080/v1, no key')
    // the provider follows from the address
    expect(providerOf('')).toBe('deepseek')
    expect(providerOf('https://api.deepseek.com/v1')).toBe('deepseek')
    expect(providerOf('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(providerOf('http://192.0.2.5:8080/v1')).toBe('custom')
    expect(providerOf('not a url')).toBe('custom')
    // without an address the default stays DeepSeek, and a provider on the internet still needs its key
    expect(withInternalDefaults({ ...example, LLM_PROVIDER: '', LLM_BASE_URL: '' }).LLM_PROVIDER).toBe('deepseek')
    expect(fixes({ ...example, LLM_PROVIDER: 'deepseek', LLM_API_KEY: '' })).toContain('./start.sh LLM_API_KEY=<key>')
  })
  it('names every problem with its fix', () => {
    const all = fixes({ ...example, LLM_ENABLED: 'false', LLM_PROVIDER: 'nope', LLM_API_KEY: '  ' })
    expect(all).toEqual(['./start.sh LLM_ENABLED=true', './start.sh LLM_PROVIDER=deepseek', './start.sh LLM_API_KEY=<key>'])
  })
  it('the package has no mock settings: no MAE_MOCK, no TASK_SIM_MS, no LLM_REQUIRED', () => {
    for (const k of ['MAE_MOCK', 'TASK_SIM_MS', 'LLM_REQUIRED']) expect(example).not.toHaveProperty(k)
  })
  it('the example file ships no MAE address and no login: they are asked for', () => {
    expect(shipped.MAE_BASE_URL).toBe('')
    expect(shipped.MAE_USERNAME).toBe('')
    expect(shipped.MAE_PASSWORD).toBe('')
    expect(fixes({ ...shipped, LLM_API_KEY: 'k' })).toEqual(['./start.sh MAE_BASE_URL=http://<host>:<port>', './start.sh MAE_USERNAME=<user> MAE_PASSWORD=<password>'])
  })
  it('with the key and the three MAE settings there is no problem', () => {
    expect(problems({ ...example, LLM_API_KEY: 'k' })).toEqual([])
  })
  it('the Network Agent needs its address and login', () => {
    const env = { ...example, LLM_API_KEY: 'k', MAE_BASE_URL: '', MAE_USERNAME: '', MAE_PASSWORD: '' }
    expect(fixes(env)).toHaveLength(2)
    expect(problems({ ...env, MAE_BASE_URL: 'http://mae:8080', MAE_USERNAME: 'u', MAE_PASSWORD: 'p' })).toEqual([])
  })
  it('the status line never shows the key, and says plainly when the LLM is not configured', () => {
    const line = llmLine({ ...example, LLM_API_KEY: 'made-up-secret' }) as string
    expect(line).toContain('key set')
    expect(line).not.toContain('secret')
    const none = llmLine(example) as string
    expect(none).toContain('not configured')
    expect(none).toContain('every request of the dialog fails')
  })
  it('the admin API is off by default', () => {
    expect(example.ADMIN_KEY).toBe('')
  })
})

describe('MAE settings: no false positive', () => {
  const real = { ...example, LLM_API_KEY: 'k' }
  it('an address without http:// is a problem', () => {
    expect(fixes({ ...real, MAE_BASE_URL: '192.0.2.5:8000' })).toContain('./start.sh MAE_BASE_URL=http://<host>:<port>')
  })
  it('an empty address is said to be empty, not to be a wrong address', () => {
    const whats = problems({ ...real, MAE_BASE_URL: '' }).map((p: { what: string }) => p.what)
    expect(whats).toContain('MAE_BASE_URL is empty: there is no Network Agent to send the tasks to')
    expect(whats.some((w: string) => w.includes('not an http'))).toBe(false)
  })
  it('check-mae shows the MAE line without the "not tested here" hint', () => {
    expect(maeLine(real)).toContain('(not tested here: ./start.sh check-mae)')
    expect(maeLine(real, false)).not.toContain('not tested')
  })
  it('the status line says which Network Agent is set and never shows the password', () => {
    const line = maeLine(real) as string
    expect(line).toContain('http://mae.example.com:8080')
    expect(line).toContain('mae-user')
    expect(line).not.toContain('mae-password')
    expect(maeLine({ ...real, MAE_BASE_URL: '' })).toContain('not configured')
  })
  it('the timeout is MAE_TIMEOUT_MS, 8000 when missing or wrong', () => {
    expect(maeTimeoutMs({ MAE_TIMEOUT_MS: '3000' })).toBe(3000)
    expect(maeTimeoutMs({})).toBe(8000)
    expect(maeTimeoutMs({ MAE_TIMEOUT_MS: 'x' })).toBe(8000)
    expect(example.MAE_TIMEOUT_MS).toBe('8000')
  })

  const check = (doFetch: (u: string, i: RequestInit) => Promise<Response>, env = real) => checkMae(env, '/login', doFetch) as Promise<{ ok: boolean; text: string }>
  const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status })
  const fails = (code: string, name = 'TypeError') => async () => {
    throw Object.assign(new Error('fetch failed'), { name, cause: { code } })
  }
  it('check-mae refuses missing settings without sending anything', async () => {
    let sent = 0
    const r = await check(async () => (sent++, new Response('{}')), { ...real, MAE_BASE_URL: '192.0.2.5:8000' })
    expect(r.ok).toBe(false)
    expect(r.text).toContain('MAE_BASE_URL')
    expect(sent).toBe(0)
  })
  it('check-mae sends the login and says OK without showing the password or the token', async () => {
    let sent = ''
    const r = await check(async (u, i) => {
      sent = u + ' ' + i.body
      return new Response(JSON.stringify({ accessToken: 'secret-token', expires: 1800 }))
    })
    expect(r.ok).toBe(true)
    expect(sent).toContain('http://mae.example.com:8080/login')
    expect(sent).toContain('"userName":"mae-user"')
    expect(r.text).not.toContain('mae-password')
    expect(r.text).not.toContain('secret-token')
  })
  it('check-mae says apart what is wrong', async () => {
    const say = async (f: (u: string, i: RequestInit) => Promise<Response>) => (await check(f)).text
    expect(await say(fails('', 'TimeoutError'))).toContain('No answer')
    expect(await say(fails('ECONNREFUSED'))).toContain('nothing listens')
    expect(
      await say(async () => {
        throw Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('all failed'), { errors: [{ code: 'ECONNREFUSED' }] }) })
      }),
    ).toContain('nothing listens')
    expect(await say(fails('ENOTFOUND'))).toContain('cannot be resolved')
    expect(await say(fails('EHOSTUNREACH'))).toContain('No route')
    expect(await say(reply(401))).toContain('user name or password is wrong')
    expect(await say(reply(404))).toContain('no MAE login there')
    expect(await say(reply(500))).toContain('HTTP 500')
    expect(await say(reply(200, { hello: 'world' }))).toContain('not a MAE login reply')
    for (const f of [fails('ECONNREFUSED'), reply(401), reply(404)]) expect((await check(f)).ok).toBe(false)
  })
  it('check-mae says a wrong protocol apart: plain http to a TLS port, https to a plain port, no scheme', async () => {
    const env = { ...example, MAE_BASE_URL: 'http://192.0.2.1:8443', MAE_USERNAME: 'u', MAE_PASSWORD: 'p' }
    const fails = (code: string, message: string) => async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) })
    }
    const text = async (f: () => Promise<never>) => (await checkMae(env, '/token', f as never)).text
    expect(await text(fails('HPE_INVALID_CONSTANT', 'Response does not match the HTTP/1.1 protocol (Expected HTTP/)'))).toContain('write https://')
    expect(await text(fails('ERR_SSL_WRONG_VERSION_NUMBER', 'wrong version number'))).toContain('http://<host>:<port>')
    expect(await text(fails('', 'unknown scheme'))).toContain('must start with http:// or https://')
    expect(await text(fails('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'))).toContain('certificate')
  })
})

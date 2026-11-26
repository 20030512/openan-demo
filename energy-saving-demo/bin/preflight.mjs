// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// What the settings of config/app.env must hold for the server to do its work. Used by ./start.sh (bin/ctl.mjs); pure, so it is
// tested without a server.
//
// A problem does not stop the start: the server starts either way, says so on the screen and in the log (ERROR records of the logger
// "startup"), and a request that needs the missing setting fails with the reason. Each problem names the exact ./start.sh command that
// fixes it.

const PROVIDERS = ['deepseek', 'openrouter', 'groq', 'gemini', 'xai', 'custom']

/** The provider of an address: a known provider by its host name, any other address is a server of your own ("custom"). */
const HOSTS = { 'deepseek.com': 'deepseek', 'openrouter.ai': 'openrouter', 'groq.com': 'groq', 'generativelanguage.googleapis.com': 'gemini', 'x.ai': 'xai' }
export function providerOf(baseUrl) {
  const url = (baseUrl || '').trim()
  if (!url) return 'deepseek'
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  const known = Object.keys(HOSTS).find((h) => host === h || host.endsWith('.' + h))
  return known ? HOSTS[known] : 'custom'
}

/**
 * LLM_PROVIDER is not needed: it follows from LLM_BASE_URL (no address: DeepSeek; a known provider's address: that provider; any
 * other address: "custom"). A custom server without a key gets a placeholder (it ignores it), and an empty LLM_MODEL means the first
 * model the server lists.
 */
export function withInternalDefaults(env) {
  const e = { ...env }
  if (!(e.LLM_PROVIDER || '').trim()) e.LLM_PROVIDER = providerOf(e.LLM_BASE_URL)
  if (e.LLM_PROVIDER === 'custom' && !(e.LLM_API_KEY || '').trim()) e.LLM_API_KEY = 'none'
  return e
}

/** The problems of the settings (an empty list: complete), each with the exact ./start.sh command that fixes it. */
export function problems(given) {
  const env = withInternalDefaults(given)
  const out = []
  const provider = env.LLM_PROVIDER || ''
  if (env.LLM_ENABLED !== 'true') out.push({ what: 'LLM_ENABLED is not true', fix: './start.sh LLM_ENABLED=true' })
  if (!PROVIDERS.includes(provider)) out.push({ what: `LLM_PROVIDER "${provider}" is not one of ${PROVIDERS.join(', ')}`, fix: './start.sh LLM_PROVIDER=deepseek' })
  if (!(env.LLM_API_KEY || '').trim()) out.push({ what: 'LLM_API_KEY is empty (a server that needs no key: any text)', fix: './start.sh LLM_API_KEY=<key>' })
  if (provider === 'custom') {
    if (!/^https?:\/\/[^/\s]+/.test(env.LLM_BASE_URL || '')) out.push({ what: 'LLM_BASE_URL must be an http:// or https:// address for LLM_PROVIDER=custom', fix: './start.sh LLM_BASE_URL=http://<host>:<port>/v1' })
  } else if (env.LLM_BASE_URL && !/^https?:\/\/[^/\s]+/.test(env.LLM_BASE_URL)) {
    out.push({ what: 'LLM_BASE_URL is not an http:// or https:// address', fix: './start.sh LLM_BASE_URL=' })
  }
  if (!(env.MAE_BASE_URL || '').trim()) out.push({ what: 'MAE_BASE_URL is empty: there is no Network Agent to send the tasks to', fix: './start.sh MAE_BASE_URL=http://<host>:<port>' })
  else if (!/^https?:\/\/[^/\s]+/.test(env.MAE_BASE_URL)) out.push({ what: 'MAE_BASE_URL is not an http:// or https:// address', fix: './start.sh MAE_BASE_URL=http://<host>:<port>' })
  if (!(env.MAE_USERNAME || '').trim() || !(env.MAE_PASSWORD || '').trim()) out.push({ what: 'MAE_USERNAME or MAE_PASSWORD is empty', fix: './start.sh MAE_USERNAME=<user> MAE_PASSWORD=<password>' })
  return out
}

/** One line for ./start.sh status, start and check-mae: which Network Agent is set, never the password. check-mae tests it, so it has no hint. */
export function maeLine(env, hint = true) {
  return `MAE: ${env.MAE_BASE_URL || 'not configured'}, login ${env.MAE_USERNAME || 'not configured'}${hint ? ' (not tested here: ./start.sh check-mae)' : ''}`
}

/** Milliseconds a connection to the Network Agent may take before it counts as no answer (MAE_TIMEOUT_MS, default 8000). */
export const maeTimeoutMs = (env) => (Number(env.MAE_TIMEOUT_MS) > 0 ? Number(env.MAE_TIMEOUT_MS) : 8000)

/**
 * ./start.sh check-mae: one login at the Network Agent, and what went wrong said apart: the address is wrong, nothing listens,
 * no answer, it is not a Network Agent, or the user name / password is refused. `doFetch` is fetch (a stub in the tests).
 * Returns { ok, text }; the password and the token are never in the text.
 */
export async function checkMae(env, tokenPath, doFetch = fetch) {
  const missing = problems(env).filter((p) => p.what.includes('MAE'))
  if (missing.length) return { ok: false, text: missing.map((m) => `${m.what}\n    fix: ${m.fix}`).join('\n') }
  const url = env.MAE_BASE_URL.replace(/\/+$/, '') + tokenPath
  const ms = maeTimeoutMs(env)
  const t0 = Date.now()
  let res
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantType: 'password', userName: env.MAE_USERNAME, value: env.MAE_PASSWORD }),
      signal: AbortSignal.timeout(ms),
    })
  } catch (e) {
    // Node nests the code: cause.code, or cause.errors[0].code when it tried more than one address (IPv4 and IPv6).
    const code = e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.code ?? ''
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { ok: false, text: `No answer from ${url} within ${ms / 1000} s: the address or port is wrong, the Network Agent is down, or a firewall drops the connection.` }
    if (code === 'ECONNREFUSED') return { ok: false, text: `Connection refused at ${env.MAE_BASE_URL}: the host is there but nothing listens on that port (wrong port, or the Network Agent is not running).` }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { ok: false, text: `The host name in ${env.MAE_BASE_URL} cannot be resolved: check the name, or use the IP address.` }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { ok: false, text: `No route to ${env.MAE_BASE_URL}: check the address and the network.` }
    // The protocol is wrong: no http:// or https://, plain http to a port that speaks https, or https to a plain http port.
    const detail = `${e?.message ?? ''} ${e?.cause?.message ?? ''} ${code}`
    if (code === 'ERR_INVALID_URL' || /unknown scheme|invalid url/i.test(detail)) return { ok: false, text: `${env.MAE_BASE_URL} is not a full address: it must start with http:// or https:// (for example http://mae.example.com:8080).` }
    if (/^HPE_/.test(code) || /does not match the HTTP|Expected HTTP\//i.test(detail)) return { ok: false, text: `Protocol mismatch: ${env.MAE_BASE_URL} answered, but not in plain HTTP. The port most likely expects https (TLS): write https:// at the start of the address. Fix: ./start.sh MAE_BASE_URL=https://<host>:<port>` }
    if (code === 'ECONNRESET' || /socket hang up|other side closed|UND_ERR_SOCKET/i.test(detail)) return { ok: false, text: `Connection closed by ${env.MAE_BASE_URL} before it answered. Most often plain http was sent to a port that expects https (TLS). Fix: ./start.sh MAE_BASE_URL=https://<host>:<port> (a firewall or gateway that drops the request looks the same).` }
    if (/WRONG_VERSION_NUMBER|wrong version number|packet length too long/i.test(detail)) return { ok: false, text: `Protocol mismatch: ${env.MAE_BASE_URL} does not speak TLS, so https cannot be used on that port. Fix: ./start.sh MAE_BASE_URL=http://<host>:<port>` }
    if (/CERT|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(code) || /certificate/i.test(detail)) return { ok: false, text: `The https certificate of ${env.MAE_BASE_URL} is not accepted (self-signed, expired or from an authority this machine does not know). Fix: ./start.sh MAE_CA_FILE=<certificate of the Network Agent, PEM file> (or use http inside a trusted network).` }
    const why = [e?.message, e?.cause?.message].filter(Boolean).join(': ')
    return { ok: false, text: `Could not reach ${url}: ${why || e}${code ? ` (${code})` : ''}` }
  }
  const took = Date.now() - t0
  if (res.status === 401 || res.status === 403) return { ok: false, text: `The Network Agent answered (HTTP ${res.status}, ${took} ms) but refused the login: the user name or password is wrong. Fix: ./start.sh MAE_USERNAME=<user> MAE_PASSWORD=<password>` }
  if (res.status === 404 || res.status === 405) return { ok: false, text: `${url} answered HTTP ${res.status}: the address is reachable but has no MAE login there. Wrong address or path, or it is not a Network Agent.` }
  if (!res.ok) return { ok: false, text: `The Network Agent answered HTTP ${res.status} (${took} ms) at ${url}. It is reachable; ask its administrator what this status means.` }
  const body = await res.json().catch(() => undefined)
  if (typeof body?.accessToken !== 'string') return { ok: false, text: `${url} answered HTTP ${res.status} but not with an access token: it is not a MAE login reply (wrong address, or not a Network Agent).` }
  return { ok: true, text: `OK (${took} ms): the Network Agent at ${env.MAE_BASE_URL} accepted the login of ${env.MAE_USERNAME}.` }
}

/** One line for ./start.sh status and start: how the LLM is set, never the key. */
export function llmLine(given) {
  const env = withInternalDefaults(given)
  if (!(env.LLM_API_KEY || '').trim() || env.LLM_ENABLED !== 'true') {
    return `LLM: not configured (${env.LLM_ENABLED !== 'true' ? 'LLM_ENABLED is not true' : 'LLM_API_KEY is empty'}); every request of the dialog fails until it is set`
  }
  const where = env.LLM_BASE_URL ? ` at ${env.LLM_BASE_URL}` : ''
  const key = env.LLM_PROVIDER === 'custom' && env.LLM_API_KEY === 'none' ? 'no key' : 'key set'
  return `LLM: ${env.LLM_PROVIDER || '?'} / ${env.LLM_MODEL || (env.LLM_PROVIDER === 'custom' ? '(the first model the server lists)' : '(provider default)')}${where}, ${key} (not tested here: ./start.sh check-llm)`
}

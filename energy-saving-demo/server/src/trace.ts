// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The log of the server, in the form the A2A projects use (orchestration-center, common/log/logger_setup.py):
 *
 *   2026-10-28 05:44:20 - llm - INFO - LLM response: purpose=routing duration_ms=2001 chars=47
 *       answer: {"intents":["submit-task"],"date":"2026-10-28"}
 *
 * that is `{time:YYYY-MM-DD HH:mm:ss} - {name} - {level} - {message}`. The logger names the part that writes (startup, api, chat, llm, task, mae.client).
 * The message is a plain sentence, `Event: key=value key=value`; a longer text (the sentence of the user, the answer of the model,
 * the cause and the action of an error) follows on lines indented by four spaces. Levels are DEBUG, INFO, WARNING and ERROR.
 * No symbols or decoration. Keys, passwords and access tokens are never written in full. LOG_LEVEL=debug adds the full prompts.
 */

/** The part of the pino logger used here; `logger` names the part that writes. */
export interface TraceLog {
  info(o: object, msg: string): void
  warn(o: object, msg: string): void
  error(o: object, msg: string): void
  debug?(o: object, msg: string): void
}

export type Fields = Record<string, string | number | boolean | undefined>

/** A value for `key=value`: plain when it has no space or quote, else in double quotes (JSON). */
const value = (v: string | number | boolean) => {
  const s = String(v)
  return s !== '' && !/[\s"=]/.test(s) ? s : JSON.stringify(s)
}

/**
 * A log message: the event, its fields as `key=value`, and the texts as indented lines.
 *   message('LLM response', { purpose: 'routing', chars: 47 }, { answer: '{"intents":[]}' })
 *   -> 'LLM response: purpose=routing chars=47\n    answer: {"intents":[]}'
 */
export function message(event: string, fields: Fields = {}, texts: Record<string, string | undefined> = {}): string {
  const kv = Object.entries(fields)
    .filter((e): e is [string, string | number | boolean] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${value(v)}`)
  const head = kv.length ? `${event}: ${kv.join(' ')}` : event
  const lines = [head]
  for (const [label, text] of Object.entries(texts)) {
    if (text === undefined || text === '') continue
    const parts = text.split('\n')
    lines.push(`    ${label}: ${parts[0]}`)
    for (const p of parts.slice(1)) lines.push(`        ${p}`)
  }
  return lines.join('\n')
}

/** A text cut to `n` characters, saying how much was left out. */
export const clip = (t: string, n = 300) => (t.length > n ? `${t.slice(0, n)}... (${t.length - n} more characters)` : t)

/** The first six characters of a token: enough to tell two tokens apart, useless to anyone else. */
export const maskToken = (t: string) => (t.length > 8 ? `${t.slice(0, 6)}...` : '***')

/** The time segments of a task in one line: 00:00~06:00 2Mbps; 06:00~24:00 50Mbps. */
export const ratesText = (r: { timeRange: string; target: string }[]) => r.map((x) => `${x.timeRange.trim()} ${x.target}`).join('; ')

/** A duration in whole milliseconds since `t0`. */
export const since = (t0: number) => Math.round(Date.now() - t0)

/** Why something failed, in words: what happened, what it means, and what to do (`fix`). */
export interface Explained {
  what: string
  meaning: string
  fix: string
}

/** The texts of an error record: the cause and the action. */
export const causeAndAction = (w: Explained) => ({ cause: `${w.what}. ${w.meaning}`, action: w.fix })

/** The code of a failed connection: Node nests it as cause.code, or cause.errors[0].code when more than one address was tried. */
export const failureCode = (e: unknown): string => {
  const x = e as { cause?: { code?: string; errors?: { code?: string }[] }; code?: string }
  return x?.cause?.code ?? x?.cause?.errors?.[0]?.code ?? x?.code ?? ''
}

/** A failed connection (no answer at all) to `where`, said apart: nothing listens, unknown name, no route, no answer in time. */
export function explainConnection(e: unknown, where: string, timeoutMs: number): { what: string; meaning: string } {
  const code = failureCode(e)
  const name = (e as Error)?.name
  const seconds = timeoutMs >= 1000 ? `${(timeoutMs / 1000).toFixed(1)} s` : `${timeoutMs} ms`
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { what: `no answer within ${seconds}`, meaning: `${where} did not answer in time: the address or port is wrong, the server is down or busy, or a firewall drops the connection.` }
  }
  if (code === 'ECONNREFUSED') return { what: 'connection refused', meaning: `The host is there but nothing listens on that port of ${where} (wrong port, or the server is not running).` }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { what: 'host name not found', meaning: `The host name of ${where} cannot be resolved: check the name, or use the IP address; on a machine without internet only addresses inside the network work.` }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { what: 'no route to the host', meaning: `This machine has no network route to ${where}: check the address and the network.` }
  // The protocol is wrong: an address without http:// or https://, plain http to a port that speaks https, or https to a plain http port.
  const detail = `${(e as Error)?.message ?? ''} ${(e as { cause?: Error })?.cause?.message ?? ''} ${code}`
  if (code === 'ERR_INVALID_URL' || /unknown scheme|invalid url/i.test(detail)) {
    return { what: 'invalid address: no http:// or https://', meaning: `${where} is not a full address: it must start with http:// or https:// (for example http://mae.example.com:8080).` }
  }
  if (/^HPE_/.test(code) || /does not match the HTTP|Expected HTTP\//i.test(detail)) {
    return { what: 'protocol mismatch: the server does not speak plain http', meaning: `${where} answered, but not in plain HTTP. The port most likely expects https (TLS): write https:// at the start of the address.` }
  }
  if (code === 'ECONNRESET' || /socket hang up|other side closed|UND_ERR_SOCKET/i.test(detail)) {
    return { what: 'connection closed by the server', meaning: `${where} closed the connection before it answered. Most often plain http was sent to a port that expects https (TLS): write https:// at the start of the address. A firewall or gateway that drops the request looks the same.` }
  }
  if (/WRONG_VERSION_NUMBER|wrong version number|packet length too long/i.test(detail)) {
    return { what: 'protocol mismatch: https used on a plain http port', meaning: `${where} does not speak TLS. Write http:// at the start of the address.` }
  }
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test((e as Error)?.message ?? '')) return { what: 'certificate problem', meaning: `The https certificate of ${where} is not accepted (self-signed, expired or from an authority this machine does not know). Give the certificate of the Network Agent in MAE_CA_FILE (PEM file), or use http inside a trusted network.` }
  const why = [(e as Error)?.message, (e as { cause?: Error })?.cause?.message].filter(Boolean).join(': ')
  return { what: 'could not connect', meaning: `${where} could not be reached${why ? ` (${why})` : ''}.` }
}

/** What an HTTP status of the Network Agent means for the login or for a task. */
export function explainMaeStatus(status: number, what: 'login' | 'task' | 'task state', url: string, detail?: string): Explained {
  const said = detail ? ` It says: ${detail}` : ''
  if (status === 401 || status === 403) {
    return what === 'login'
      ? { what: `HTTP ${status}`, meaning: `The Network Agent refused the login: the user name or password is wrong.${said}`, fix: './start.sh MAE_USERNAME=<user> MAE_PASSWORD=<password>   then test: ./start.sh check-mae' }
      : { what: `HTTP ${status}`, meaning: `The Network Agent refused the access token (expired or not accepted).${said}`, fix: 'ask again; if it repeats, test the login: ./start.sh check-mae' }
  }
  if (status === 404 || status === 405) {
    return { what: `HTTP ${status}`, meaning: `${url} is reachable but has nothing for this request: wrong address or path, or it is not a Network Agent.${said}`, fix: 'check MAE_BASE_URL: ./start.sh check-mae' }
  }
  if (status === 400 || status === 422) return { what: `HTTP ${status}`, meaning: `The Network Agent did not accept the ${what}.${said}`, fix: 'read its reason above; for a region name use one of the regions it lists' }
  if (status >= 500) return { what: `HTTP ${status}`, meaning: `The Network Agent itself failed (not your settings).${said}`, fix: 'try again later; if it stays, ask the MAE administrator' }
  return { what: `HTTP ${status}`, meaning: `The Network Agent answered with an unexpected status.${said}`, fix: 'ask the MAE administrator what this status means' }
}

/** The Network Agent as the log names it. */
export const maeWhere = (baseUrl: string) => baseUrl

/** The short reason in an error answer of the Network Agent ({"error":{"message":"..."}}), else the start of the text. */
export function maeDetail(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown }
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? j.detail)
    if (typeof m === 'string') return clip(m, 300)
  } catch {
    /* not JSON */
  }
  return clip(text.replace(/\s+/g, ' ').trim(), 300)
}

/** Milliseconds a connection to the Network Agent may take (MAE_TIMEOUT_MS, default 8000). */
export const maeTimeout = () => (Number(process.env.MAE_TIMEOUT_MS) > 0 ? Number(process.env.MAE_TIMEOUT_MS) : 8000)

/** The headers of an answer as one JSON line; the values that carry a secret are cut. */
export function headersText(h: { forEach(cb: (value: string, key: string) => void): void }): string {
  const o: Record<string, string> = {}
  h.forEach((v, k) => {
    o[k] = /authorization|token|cookie|key/i.test(k) ? maskToken(v) : v
  })
  return JSON.stringify(o)
}

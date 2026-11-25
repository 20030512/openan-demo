// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { TOKEN_PATH, type MaeFetch } from '../../mae/protocol.js'
import { causeAndAction, explainConnection, explainMaeStatus, maeDetail, maeTimeout, headersText, maskToken, message, since, type TraceLog } from '../../trace.js'
import { SkillError } from './errors.js'

/** The MAE login. */
export interface MaeLogin {
  user: string
  password: string
}

/**
 * The login from the settings MAE_USERNAME and MAE_PASSWORD, read each time a token is needed. The password is not written to the
 * database or anywhere else: it stays in the settings of the server (config/app.env, readable by its owner only).
 */
export const loginFromSettings = (): MaeLogin | null => {
  const user = process.env.MAE_USERNAME ?? ''
  const password = process.env.MAE_PASSWORD ?? ''
  return user && password ? { user, password } : null
}

/** Posts the login to the Network Agent and keeps the access token until 60 s before it expires. */
export class TokenClient {
  private token: string | null = null
  private expiry = 0

  constructor(
    private maeFetch: MaeFetch,
    private baseUrl: string,
    /** The login is written to the log as one request record and one response (or failure) record; the answer to the user keeps the text of the design. */
    private log?: TraceLog,
    private login: () => MaeLogin | null = loginFromSettings,
  ) {}

  async getAccessToken(force = false): Promise<string> {
    const now = Date.now()
    if (!force && this.token && now < this.expiry - 60_000) return this.token

    const fail = (what: string, fix: string, status: number, userText: string) => {
      this.log?.error({ logger: 'mae.client' }, message('MAE login not possible', {}, { cause: what, action: fix }))
      return new SkillError(status, userText)
    }
    if (!this.baseUrl) throw fail('MAE_BASE_URL is not set, so there is no Network Agent to log in to.', './start.sh MAE_BASE_URL=http://<host>:<port>', 503, 'The Network Agent is not configured, please contact the administrator')
    const login = this.login()
    if (!login) throw fail('MAE_USERNAME and MAE_PASSWORD are not set, so there is no login.', './start.sh MAE_USERNAME=<user> MAE_PASSWORD=<password>', 503, 'Authentication information is not configured, please contact the administrator')

    const user = login.user
    const url = `${this.baseUrl}${TOKEN_PATH}`
    const failed = 'Authentication failed, please check the username and password or the network connection'
    const t0 = Date.now()
    this.log?.info({ logger: 'mae.client' }, message('MAE login request', { method: 'POST', url, user }, { headers: JSON.stringify({ 'content-type': 'application/json' }), payload: JSON.stringify({ grantType: 'password', userName: user, value: '********' }) }))

    let res: Response
    try {
      res = await this.maeFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grantType: 'password', userName: user, value: login.password }),
      })
    } catch (e) {
      const c = explainConnection(e, this.baseUrl, maeTimeout())
      this.log?.error({ logger: 'mae.client' }, message('MAE login failed', { url, user, duration_ms: since(t0) }, { summary: c.what, cause: c.meaning, action: 'check MAE_BASE_URL, then test: ./start.sh check-mae', user_message: failed }))
      throw new SkillError(502, failed)
    }
    const answer = await res.text().catch(() => '')
    if (!res.ok) {
      const w = explainMaeStatus(res.status, 'login', url, maeDetail(answer))
      this.log?.error({ logger: 'mae.client' }, message('MAE login failed', { url, user, status: res.status, duration_ms: since(t0) }, { summary: w.what, response_headers: headersText(res.headers), body: answer.trim().slice(0, 2000) || '(empty)', ...causeAndAction(w), user_message: failed }))
      throw new SkillError(502, failed)
    }
    let j: { expires?: number; accessToken?: string } = {}
    try {
      j = JSON.parse(answer)
    } catch {
      /* not JSON: reported below as an answer without a token */
    }
    if (typeof j.accessToken !== 'string') {
      this.log?.error({ logger: 'mae.client' }, message('MAE login failed', { url, user, status: res.status, duration_ms: since(t0) }, { summary: 'the answer has no access token', response_headers: headersText(res.headers), body: answer.trim().slice(0, 2000) || '(empty)', cause: `${url} answered, but not like a MAE login: wrong address, or not a Network Agent.`, action: 'check MAE_BASE_URL: ./start.sh check-mae', user_message: failed }))
      throw new SkillError(502, failed)
    }
    this.token = j.accessToken
    this.expiry = now + (j.expires ?? 1800) * 1000
    this.log?.info({ logger: 'mae.client' }, message('MAE login response', { status: res.status, duration_ms: since(t0), token: maskToken(this.token), expires_s: j.expires ?? 1800 }, { response_headers: headersText(res.headers), body: JSON.stringify({ ...j, accessToken: maskToken(this.token) }) }))
    return this.token
  }
}

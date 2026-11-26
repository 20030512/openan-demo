// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { TOKEN_PATH } from './mae/protocol.js'
import { causeAndAction, explainConnection, explainMaeStatus, maeDetail, maeTimeout, message, since, type TraceLog } from './trace.js'

/**
 * One login at the Network Agent when the server starts, so a wrong address or a wrong login is in the log before the first task.
 * Nothing else is sent. It never throws: the result is a record in the log (INFO when it works, ERROR with the cause and the action
 * when it does not).
 */
export async function checkMaeLogin(baseUrl: string, user: string, password: string, log: TraceLog, doFetch: typeof fetch = fetch): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, '')}${TOKEN_PATH}`
  const t0 = Date.now()
  const o = { logger: 'startup' }
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantType: 'password', userName: user, value: password }),
      signal: AbortSignal.timeout(maeTimeout()),
    })
    if (!res.ok) {
      const w = explainMaeStatus(res.status, 'login', url, maeDetail(await res.text().catch(() => '')))
      log.error(o, message('MAE login check failed', { url, user, status: res.status, duration_ms: since(t0) }, { summary: w.what, ...causeAndAction(w) }))
      return false
    }
    const j = (await res.json().catch(() => ({}))) as { accessToken?: unknown }
    if (typeof j.accessToken !== 'string') {
      log.error(o, message('MAE login check failed', { url, user, status: res.status, duration_ms: since(t0) }, { summary: 'the answer has no access token', cause: `${url} answered, but not like a MAE login: wrong address, or not a Network Agent.`, action: 'check MAE_BASE_URL: ./start.sh check-mae' }))
      return false
    }
    log.info(o, message('MAE login check succeeded', { url, user, duration_ms: since(t0) }))
    return true
  } catch (e) {
    const c = explainConnection(e, baseUrl, maeTimeout())
    log.error(o, message('MAE login check failed', { url, user, duration_ms: since(t0) }, { summary: c.what, cause: c.meaning, action: 'check MAE_BASE_URL, then test: ./start.sh check-mae' }))
    return false
  }
}

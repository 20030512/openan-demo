// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/** Management API for the LLM settings (admin key required). The key is write-only: only a masked form is returned. */
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db.js'
import { body, HttpError, requireAdmin } from '../http.js'
import { checkBaseUrl, maskKey, PRESETS, readSettings, testSettings, writeSettings, type LlmSettings } from '../llm.js'

const view = (s: LlmSettings) => ({ enabled: s.enabled, provider: s.provider, baseUrl: s.baseUrl, model: s.model, hasKey: !!s.apiKey, keyHint: maskKey(s.apiKey) })

export function llmRoutes(app: FastifyInstance, db: Db, doFetch: typeof fetch) {
  app.get('/api/admin/llm', async (req) => {
    requireAdmin(req)
    return { presets: PRESETS, settings: view(readSettings(db)) }
  })

  app.put('/api/admin/llm', async (req) => {
    requireAdmin(req)
    const b = body(req)
    const cur = readSettings(db)
    const provider = typeof b.provider === 'string' && PRESETS.some((p) => p.id === b.provider) ? b.provider : undefined
    if (!provider) throw new HttpError(400, 'provider is not one of the known providers')
    if (typeof b.model !== 'string' || !/^[\w./:@+-]{1,100}$/.test(b.model)) throw new HttpError(400, 'model must be 1 to 100 characters, such as llama-3.3-70b-versatile')
    if (typeof b.baseUrl !== 'string') throw new HttpError(400, 'baseUrl is required')
    let apiKey = cur.apiKey
    if (b.apiKey !== undefined) {
      if (typeof b.apiKey !== 'string' || b.apiKey.length > 300 || /\s/.test(b.apiKey)) throw new HttpError(400, 'apiKey must be one word of up to 300 characters')
      apiKey = b.apiKey // an empty string clears the key
    }
    const enabled = b.enabled === true
    if (enabled && !apiKey) throw new HttpError(400, 'set an API key before switching the LLM on')
    const next: LlmSettings = { enabled, provider, baseUrl: checkBaseUrl(b.baseUrl), model: b.model, apiKey }
    writeSettings(db, next)
    return view(next)
  })

  /** Calls the saved provider once, so a wrong key, model or URL shows up here and not in the dialog. */
  app.post('/api/admin/llm/test', async (req) => {
    requireAdmin(req)
    const s = readSettings(db)
    if (!s.apiKey) throw new HttpError(400, 'no API key is saved')
    return testSettings(s, doFetch)
  })
}

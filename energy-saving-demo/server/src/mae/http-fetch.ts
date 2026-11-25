// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'

/**
 * `fetch` for the Network Agent. The certificate of an https Network Agent is checked, as `fetch` does. An https Network Agent inside the
 * customer network often has a certificate of its own (self-signed, or from an authority this machine does not know): give its
 * certificate, or the certificate of its authority, in MAE_CA_FILE (a PEM file). Only if that is not possible, MAE_TLS_VERIFY=false
 * switches the check off; the server then logs a warning at every start. Everything else is as with `fetch`: a Response, a stream
 * that can be read while it arrives (the A2A-T answer is a stream), the AbortSignal, redirects (up to 5). Errors carry the Node
 * codes (ECONNREFUSED, ERR_SSL_WRONG_VERSION_NUMBER, HPE_INVALID_CONSTANT ...) that trace.ts explains.
 */
export interface TlsSettings {
  rejectUnauthorized: boolean
  ca?: Buffer
}

const caCache = new Map<string, Buffer>()

/** The TLS settings of the MAE connection from MAE_TLS_VERIFY (default true) and MAE_CA_FILE (default: none). */
export function tlsSettings(env: NodeJS.ProcessEnv = process.env): TlsSettings {
  const rejectUnauthorized = (env.MAE_TLS_VERIFY ?? 'true').trim().toLowerCase() !== 'false'
  const file = (env.MAE_CA_FILE ?? '').trim()
  if (!file) return { rejectUnauthorized }
  let ca = caCache.get(file)
  if (!ca) {
    try {
      ca = readFileSync(file)
    } catch (e) {
      throw new Error(`MAE_CA_FILE ${file} cannot be read: ${(e as Error).message}`)
    }
    caCache.set(file, ca)
  }
  return { rejectUnauthorized, ca }
}

export const maeFetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => call(input, init, 0)) as typeof fetch

const REDIRECTS = [301, 302, 303, 307, 308]

function badAddress(what: string) {
  return Object.assign(new TypeError(`Failed to parse URL: ${what}`), { cause: Object.assign(new Error(what), { code: 'ERR_INVALID_URL' }) })
}

function call(input: string | URL | Request, init: RequestInit | undefined, hops: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    } catch {
      return reject(badAddress('Invalid URL'))
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(badAddress('unknown scheme'))

    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = init?.body === undefined || init.body === null ? undefined : String(init.body)
    if (body !== undefined && headers['content-length'] === undefined) headers['content-length'] = String(Buffer.byteLength(body))
    const method = init?.method ?? 'GET'

    let tls: TlsSettings
    try {
      tls = tlsSettings()
    } catch (e) {
      return reject(e)
    }
    const options = url.protocol === 'https:' ? { method, headers, rejectUnauthorized: tls.rejectUnauthorized, ca: tls.ca, signal: init?.signal ?? undefined } : { method, headers, signal: init?.signal ?? undefined }
    const req = (url.protocol === 'https:' ? https : http).request(url, options, (res) => {
      const status = res.statusCode ?? 0
      const location = res.headers.location
      if (REDIRECTS.includes(status) && location && hops < 5) {
        res.resume()
        const next = new URL(location, url).href
        const keep = status === 307 || status === 308
        return resolve(call(next, keep ? init : { ...init, method: 'GET', body: undefined }, hops + 1))
      }
      const out = new Headers()
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v)
      const empty = status === 204 || status === 205 || status === 304
      resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, statusText: res.statusMessage ?? '', headers: out }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/** The fetch of the Network Agent: the certificate is checked; a certificate of its own is given in MAE_CA_FILE, or the check is switched off. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import selfsigned from 'selfsigned'
import { afterAll, describe, expect, it } from 'vitest'
import { maeFetch, tlsSettings } from '../src/mae/http-fetch.js'
import { explainConnection } from '../src/trace.js'

// A throw-away self-signed certificate for 127.0.0.1, made for this run only: no key is kept in the repository.
const pems = await selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }], {
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] },
  ],
})
const tls = { key: pems.private, cert: pems.cert }
const fixtures = mkdtempSync(join(tmpdir(), 'mae-tls-'))
writeFileSync(join(fixtures, 'selfsigned-cert.pem'), pems.cert)
afterAll(() => rmSync(fixtures, { recursive: true, force: true }))

const handler: http.RequestListener = (req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/redirect') {
      res.writeHead(307, { location: '/echo' })
      return res.end()
    }
    if (req.url === '/hang') return // never answers
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"task":{"id":"t1"}}\n\n')
      return setTimeout(() => res.end('data: {"done":true}\n\n'), 30)
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization, body }))
  })
}

const caught = async (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e)
const servers: { close(): void }[] = []
const listen = (s: http.Server | https.Server) =>
  new Promise<string>((resolve) => {
    servers.push(s)
    s.listen(0, '127.0.0.1', () => resolve(`${s instanceof https.Server ? 'https' : 'http'}://127.0.0.1:${(s.address() as AddressInfo).port}`))
  })
afterAll(() => servers.forEach((s) => s.close()))

describe('maeFetch', () => {
  it('works like fetch on http: method, headers, body and the answer', async () => {
    const base = await listen(http.createServer(handler))
    const res = await maeFetch(`${base}/echo`, { method: 'POST', headers: { authorization: 'Bearer abc', 'content-type': 'application/json' }, body: '{"a":1}' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ method: 'POST', auth: 'Bearer abc', body: '{"a":1}' })
  })

  it('checks the certificate of an https server by default, as fetch does', async () => {
    const base = await listen(https.createServer(tls, handler))
    await expect(fetch(`${base}/echo`)).rejects.toThrow()
    const err = await caught(maeFetch(`${base}/echo`))
    expect(explainConnection(err, base, 8000).what).toBe('certificate problem')
  })

  it('accepts the certificate of the Network Agent when it is given in MAE_CA_FILE', async () => {
    const base = await listen(https.createServer(tls, handler))
    const before = process.env.MAE_CA_FILE
    process.env.MAE_CA_FILE = join(fixtures, 'selfsigned-cert.pem')
    try {
      const res = await maeFetch(`${base}/echo`)
      expect(res.status).toBe(200)
    } finally {
      if (before === undefined) delete process.env.MAE_CA_FILE
      else process.env.MAE_CA_FILE = before
    }
  })

  it('switches the check off only with MAE_TLS_VERIFY=false', async () => {
    const base = await listen(https.createServer(tls, handler))
    const before = process.env.MAE_TLS_VERIFY
    process.env.MAE_TLS_VERIFY = 'false'
    try {
      const res = await maeFetch(`${base}/echo`)
      expect(res.status).toBe(200)
      expect((await res.json()).method).toBe('GET')
    } finally {
      if (before === undefined) delete process.env.MAE_TLS_VERIFY
      else process.env.MAE_TLS_VERIFY = before
    }
  })

  it('reads the TLS settings: checked by default, a CA file only when it exists', () => {
    expect(tlsSettings({})).toEqual({ rejectUnauthorized: true })
    expect(tlsSettings({ MAE_TLS_VERIFY: 'FALSE' }).rejectUnauthorized).toBe(false)
    expect(tlsSettings({ MAE_TLS_VERIFY: 'true' }).rejectUnauthorized).toBe(true)
    expect(tlsSettings({ MAE_CA_FILE: join(fixtures, 'selfsigned-cert.pem') }).ca).toBeInstanceOf(Buffer)
    expect(() => tlsSettings({ MAE_CA_FILE: join(fixtures, 'missing.pem') })).toThrow(/MAE_CA_FILE/)
  })

  it('follows a redirect and keeps method and body on 307', async () => {
    const base = await listen(http.createServer(handler))
    const res = await maeFetch(`${base}/redirect`, { method: 'POST', body: 'x' })
    expect(await res.json()).toMatchObject({ method: 'POST', body: 'x' })
  })

  it('gives a stream that can be read while it arrives', async () => {
    const base = await listen(http.createServer(handler))
    const res = await maeFetch(`${base}/stream`)
    const text = await res.text()
    expect(text).toContain('"id":"t1"')
    expect(text).toContain('"done":true')
  })

  it('errors that trace.ts explains: refused, no answer in time, no http:// in front, plain http to an https port', async () => {
    const dead = await listen(http.createServer(handler))
    servers.pop()?.close()
    expect(explainConnection(await caught(maeFetch(`${dead}/x`)), dead, 8000).what).toBe('connection refused')

    const hang = await listen(http.createServer(handler))
    expect(explainConnection(await caught(maeFetch(`${hang}/hang`, { signal: AbortSignal.timeout(80) })), hang, 80).what).toContain('no answer within')

    expect(explainConnection(await caught(maeFetch('127.0.0.1:9100/x')), '127.0.0.1:9100', 8000).what).toContain('no http:// or https://')

    const secure = await listen(https.createServer(tls, handler))
    const plain = secure.replace('https', 'http')
    expect(explainConnection(await caught(maeFetch(`${plain}/x`)), plain, 8000).what).toContain('connection closed by the server')

    const web = await listen(http.createServer(handler))
    const tlsToPlain = web.replace('http', 'https')
    expect(explainConnection(await caught(maeFetch(`${tlsToPlain}/x`)), tlsToPlain, 8000).what).toContain('https used on a plain http port')
  })
})

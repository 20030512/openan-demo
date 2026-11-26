// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

/** Error with an HTTP status; the app's error handler turns it into { detail }. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function intIn(v: unknown, name: string, min: number, max: number): number {
  if (!isInt(v) || v < min || v > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`)
  return v
}

export function body(req: { body: unknown }): Record<string, unknown> {
  if (typeof req.body !== 'object' || req.body === null) throw new HttpError(400, 'JSON body required')
  return req.body as Record<string, unknown>
}

/** The LLM settings API needs the admin key (ADMIN_KEY). There is no default key: when it is not set, the API is switched off. */
export function requireAdmin(req: FastifyRequest) {
  const expected = process.env.ADMIN_KEY ?? ''
  if (!expected) throw new HttpError(403, 'admin access is not configured (set ADMIN_KEY)')
  const given = req.headers['x-admin-key']
  const a = Buffer.from(typeof given === 'string' ? given : '')
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'wrong admin key')
}

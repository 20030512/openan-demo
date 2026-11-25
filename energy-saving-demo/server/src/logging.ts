// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The logger of the server. The lines follow the layout of the A2A projects (orchestration-center, common/log/logger_setup.py):
 *   2026-10-28 05:44:20 - llm - INFO - LLM response: purpose=routing duration_ms=2001 chars=47
 * that is {time:YYYY-MM-DD HH:mm:ss} - {name} - {level} - {message}, the time local. See trace.ts for the messages.
 * With LOG_FORMAT=json the server does not use this.
 */
import { Writable } from 'node:stream'
import type { FastifyBaseLogger } from 'fastify'
import pino from 'pino'

/** The names of the levels as Python writes them. */
const LEVELS: Record<number, string> = { 10: 'DEBUG', 20: 'DEBUG', 30: 'INFO', 40: 'WARNING', 50: 'ERROR', 60: 'CRITICAL' }

const two = (n: number) => String(n).padStart(2, '0')

/** 2026-10-28 05:44:20 */
export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

/** One pino record (a JSON line) as a line of the log; a line that is not a record is passed on as it is. */
export function formatRecord(line: string): string {
  let r: { time?: number; level?: number; logger?: string; msg?: string; err?: { message?: string } }
  try {
    r = JSON.parse(line)
  } catch {
    return line.trimEnd()
  }
  const name = typeof r.logger === 'string' ? r.logger : 'server'
  let text = typeof r.msg === 'string' ? r.msg : ''
  if (r.err?.message) text += `${text ? ': ' : ''}${r.err.message}`
  return `${stamp(r.time ?? Date.now())} - ${name} - ${LEVELS[r.level ?? 30] ?? 'INFO'} - ${text}`
}

/** A pino logger that writes the records in that layout to `out`. */
export function pythonStyleLogger(level: string, out: { write(s: string): unknown } = process.stdout) {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n')) if (line) out.write(formatRecord(line) + '\n')
      done()
    },
  })
  return pino({ level, base: undefined, timestamp: pino.stdTimeFunctions.epochTime }, stream) as unknown as FastifyBaseLogger
}

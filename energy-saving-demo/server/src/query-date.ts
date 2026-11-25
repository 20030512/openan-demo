// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The day of a price or plan query, as the energy-saving-query skill passes it: a word (today, yesterday, tomorrow,
 * day before yesterday, day after tomorrow, N days ago, 今天, 昨天, 前天, 明天, 后天, N天前) resolved against `now`, or a
 * date (YYYY-MM-DD, YYYY/M/D, YYYY.M.D, YYYYMMDD). Empty is today. Anything else is refused: the day is never guessed.
 */

export class QueryDateError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const RELATIVE: [RegExp, number][] = [
  [/^(day before yesterday|前天)$/, -2],
  [/^(yesterday|昨天|昨日)$/, -1],
  [/^(today|今天|今日)$/, 0],
  [/^(tomorrow|明天|明日)$/, 1],
  [/^(day after tomorrow|后天)$/, 2],
]

/** A real calendar date (no 2026-02-30) as YYYY-MM-DD, else null. */
function calendarDate(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? iso(date) : null
}

export function resolveQueryDate(input: string | undefined, now = new Date()): string {
  const text = (input ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const shift = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
  if (!text) return shift(0)
  for (const [word, offset] of RELATIVE) if (word.test(text)) return shift(offset)
  const ago = /^(\d{1,3}) days? ago$/.exec(text) ?? /^(\d{1,3})天前$/.exec(text)
  if (ago) return shift(-Number(ago[1]))
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (m) {
    const date = calendarDate(Number(m[1]), Number(m[2]), Number(m[3]))
    if (date) return date
    throw new QueryDateError(`"${input}" is not a valid calendar date`)
  }
  throw new QueryDateError(`Cannot read the day "${input}". Use today, yesterday, tomorrow, "N days ago" or a date as YYYY-MM-DD.`)
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The vocabulary of the dialog (design doc 1.2 and 3.2): the actions, the parameters of a task, and the time segments of the rate
 * guarantee. The sentence is read by the LLM (llm.ts); there is no other reader in the server.
 */
export type Intent = 'submit-task' | 'query-price' | 'query-plan' | 'query-both' | 'unknown'

/** One time segment of the guaranteed throughput target: {00:00~06:00,2Mbps}. */
export interface RateSegment {
  start: string
  end: string
  mbps: number
}

/** One time range and its rate guarantee, as the model writes it: {"timeRange":"00:00~06:00","target":"2Mbps"}. */
export interface RateRange {
  timeRange: string
  target: string
}

export interface TaskParams {
  region: string
  /**
   * The time-segment-based guaranteed downlink rate: `[{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}]`
   * (the "rateMbps" of the parameters prompt). A sentence with a single rate gives one range for the whole day.
   */
  rateMbps: RateRange[]
  reserveBackupRatio: number
}

const clock = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
const minutes = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5))

/** Segments in order, inside the day, with a rate above zero; else nothing (an empty list). */
function checked(list: RateSegment[]): RateSegment[] {
  let last = 0
  for (const x of list) {
    if (!(minutes(x.start) < minutes(x.end)) || minutes(x.end) > 1440 || minutes(x.start) < last || !(x.mbps > 0)) return []
    last = minutes(x.end)
  }
  return list
}

/**
 * Read the time-segment rate guarantee: a list of {"timeRange":"00:00~06:00","target":"2Mbps"}, as a list or as
 * JSON text (the quotes may arrive escaped, \", as when the answer of a model was written into a JSON string).
 * Segments that are not in order, overlap, or are outside the day are refused (an empty list).
 */
export function parseRateSegments(input: string | RateRange[]): RateSegment[] {
  const text = (typeof input === 'string' ? input : JSON.stringify(input)).split('\\"').join('"')
  // 00:00~06:00, also 0~6 or 0:00-6:00 (hours without minutes, as a model may write them)
  const range = /^(\d{1,2})(?::(\d{2}))?\s*[~～–-]\s*(\d{1,2})(?::(\d{2}))?$/
  let j: unknown
  try {
    j = JSON.parse(text.trim())
  } catch {
    return []
  }
  if (!Array.isArray(j)) return []
  const list: RateSegment[] = []
  for (const item of j) {
    const r = (item && typeof item === 'object' ? item : {}) as { timeRange?: unknown; target?: unknown }
    if (typeof r.timeRange !== 'string' || (typeof r.target !== 'string' && typeof r.target !== 'number')) return []
    const m = range.exec(r.timeRange.trim()) // the model may put a space before the time, " 00:00~06:00"
    const mbps = typeof r.target === 'number' ? r.target : /^\s*\d+(\.\d+)?\s*(mbps)?\s*$/i.test(r.target) ? parseFloat(r.target) : NaN
    if (!m || Number(m[2] ?? 0) > 59 || Number(m[4] ?? 0) > 59) return []
    list.push({ start: clock(Number(m[1]), Number(m[2] ?? 0)), end: clock(Number(m[3]), Number(m[4] ?? 0)), mbps })
  }
  return checked(list)
}

/** The rateMbps of TaskParams: [{"timeRange":"00:00~06:00","target":"2Mbps"},{"timeRange":"06:00~24:00","target":"50Mbps"}]. */
export const rateRanges = (s: RateSegment[]): RateRange[] => s.map((x) => ({ timeRange: `${x.start}~${x.end}`, target: `${x.mbps}Mbps` }))

/** The text of the segments as the Task-T text writes them: {00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}. */
export const formatRateSegments = (s: RateSegment[]) => s.map((x) => `{${x.start}~${x.end},${x.mbps}Mbps}`).join(', ')

/** One rate for the whole day: the target when the sentence names no idle hours. */
export const allDayRate = (rate: number): RateSegment[] => [{ start: '00:00', end: '24:00', mbps: rate }]

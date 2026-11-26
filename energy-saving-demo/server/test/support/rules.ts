// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * A rule-based reader of the dialog sentences, FOR THE TESTS ONLY. The server reads every sentence with the LLM; the tests need an
 * answer that is the same every time, so `rulesLlm` is a stand-in for the provider: it answers the two prompts of the server
 * (routing and task parameters) with these rules.
 */
import { allDayRate, rateRanges, type Intent, type RateSegment, type TaskParams } from '../../src/intent.js'

const clock = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/** Idle hours and their rate from the sentence ("idle hours 0~6 o'clock ... 2Mbps", "闲时0~6点...2Mbps"), with the rate of the rest of the day. */
function segmentsFromSentence(text: string, nonIdle: number): RateSegment[] | undefined {
  const m = /(?:idle hours?|闲时)\s*(\d{1,2})\s*[~～-]\s*(\d{1,2})[^\d]{0,40}?(\d+(?:\.\d+)?)\s*mbps/i.exec(text)
  if (!m) return undefined
  const from = Number(m[1])
  const to = Number(m[2])
  const idle = Number(m[3])
  if (!(from < to) || to > 24 || !(idle > 0)) return undefined
  const segs: RateSegment[] = []
  if (from > 0) segs.push({ start: '00:00', end: clock(from, 0), mbps: nonIdle })
  segs.push({ start: clock(from, 0), end: clock(to, 0), mbps: idle })
  if (to < 24) segs.push({ start: clock(to, 0), end: '24:00', mbps: nonIdle })
  return segs
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const PRICE = /price|tariff|电价|价格/i
const PLAN = /plan|slot|charge|discharge|schedule|充放电|充电|放电|时段|规划/i
const TASK = /create|task|submit|dispatch|enable|allow|创建|任务|下发|节能意图/i
const DATA = /\bdata\b|information|数据|信息/i

/** Resolve "today", "yesterday", "tomorrow", YYYY-MM-DD or YYYYMMDD (and the Chinese words) against `now`. */
export function parseDay(text: string, now = new Date()): string {
  const m = /(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(text)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(now)
  const ago = /(\d+) days? ago/i.exec(text)
  if (ago) d.setDate(d.getDate() - Number(ago[1]))
  else if (/yesterday|昨天|昨日|previous day|day before|last day|a day ago|one day ago|前一天|上一天/i.test(text)) d.setDate(d.getDate() - 1)
  else if (/tomorrow|明天|明日/i.test(text)) d.setDate(d.getDate() + 1)
  return iso(d)
}

const CREATE = /\b(create|submit|dispatch|new)\b|创建|下发|新建|节能任务|节能意图/i
const QUERY_VERB = /\b(query|show|check|list|display|get|what|how much|tell)\b|查询|查看|显示|看看|多少/i

/**
 * Every action the text asks for, in the order to run them. One sentence may mix the three skill features, for
 * example "create a task in region A and show today's price and plan" gives ['submit-task', 'query-both'].
 * A task sentence that merely mentions prices ("... based on dynamic electricity prices") is not also a query:
 * a query needs a question word.
 */
export function classifyAll(text: string): Intent[] {
  const price = PRICE.test(text)
  const plan = PLAN.test(text)
  const data = DATA.test(text) && !price && !plan // "show me the data of a day" asks for both tables
  const strongTask = /region|区域/i.test(text) && (/rate|mbps|速率/i.test(text) || /reserve|备电/i.test(text))
  const task = strongTask || CREATE.test(text) || (TASK.test(text) && !price && !plan)
  const out: Intent[] = []
  if (task) out.push('submit-task')
  if ((price || plan || data) && (!task || QUERY_VERB.test(text))) out.push(data || (price && plan) ? 'query-both' : price ? 'query-price' : 'query-plan')
  return out.length ? out : ['unknown']
}

/** The first action, for callers that only need one. */
export const classify = (text: string): Intent => classifyAll(text)[0]

/** Pull region, non-idle downlink rate and reserve ratio out of the intent text (design doc 3.2.2 step 1). */
export function extractTaskParams(text: string): TaskParams {
  // Chinese has no space after the name, so the name ends before the next words of the sentence (创建, 节能, 任务) or punctuation.
  const region = /(?:region|区域)\s*([\p{L}\p{N}_-]+?)(?=创建|节能|任务|[^\p{L}\p{N}_-]|$)/iu.exec(text)?.[1] ?? ''
  const rates = [...text.matchAll(/(\d+(?:\.\d+)?)\s*mbps/gi)].map((m) => Number(m[1]))
  const reserve = /(\d+(?:\.\d+)?)\s*%/.exec(text)
  const rate = rates.length ? Math.max(...rates) : 50
  // rateMbps is the time-segment target: the idle hours of the sentence, else one rate for the whole day
  const segments = segmentsFromSentence(text, rate) ?? allDayRate(rate)
  return { region, rateMbps: rateRanges(segments), reserveBackupRatio: reserve ? Number(reserve[1]) : 50 }
}

/** A `fetch` that answers like an OpenAI-compatible provider, with the rules above. */
export const rulesLlm: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] }
  const last = body.messages[body.messages.length - 1].content
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  if (last.includes('Read the energy-saving task')) {
    // the sentence is the last "Message:" of the parameter prompt (the first one is the example)
    const sentence = (last.split('\nMessage: ').pop() ?? '').replace(/\nAnswer:\s*$/, '')
    return reply(JSON.stringify(extractTaskParams(sentence)))
  }
  const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(body.messages[0]?.content ?? '')?.[1]
  return reply(JSON.stringify({ intents: classifyAll(last), date: parseDay(last, today ? new Date(`${today}T12:00:00`) : new Date()) }))
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Typed wrappers for the backend (design doc 7.14). Every call throws Error(message) on a non-2xx reply.

export type Trend = 'up' | 'down'

export interface EnergySummary {
  currentConsumption: number
  totalEnergySavingGain: number
  metrics: { label: string; value: number; unit: string; trend: Trend }[]
  gainDistribution: { totalSaving: number; unit: string; modes: { name: string; value: number; percent: number }[] }
}

export interface Series {
  name: string
  data: number[]
}

export interface Kpi {
  suggestionCards: { label: string; executed: number; total: number }[]
  trendChart: { xAxis: string[]; series: Series[] }
}

export interface EnergyCurves {
  energyTrend: { xAxis: string[]; series: Series[] }
  priceDischarge: { date: string; xAxis: string[]; price: number[]; discharge: number[] }
}

export interface TaskResult {
  success: boolean
  taskId: string
  message: string
}

// The task shapes are the server's (server/src/api-types.ts, one definition for both sides).
import type { EffectReport, Proposal, TaskState } from '../../../server/src/api-types.ts'
export type { Proposal, TaskState } from '../../../server/src/api-types.ts'
export type EnergyEffect = EffectReport

export type Stage = 'LOW' | 'FLAT' | 'PEAK'
export interface PriceRow { date: string; timeSlot: string; price: number }
export interface PlanRow { date: string; startTime: string; endTime: string; stage: Stage }
export interface DayQuery { day: string; batchId: number; prices: PriceRow[]; plan: PlanRow[] }

export type Intent = 'submit-task' | 'query-price' | 'query-plan' | 'query-both' | 'unknown'
export interface TaskView {
  taskId: string
  region: string
  state: TaskState
  progress: number
  final: boolean
  error?: string
  createdAt: string
  proposal?: Proposal
}
/** rateMbps is the time-segment-based rate guarantee, for example [{"timeRange":"00:00~06:00","target":"2Mbps"}]. */
export interface TaskParams { region: string; rateMbps: { timeRange: string; target: string }[]; reserveBackupRatio: number }
/** One thing the text asked for. A message can ask for several, so the dialog gets a list. */
export type ChatAction =
  | { kind: 'task'; intent: 'submit-task'; success: true; taskId: string; params: TaskParams; message: string }
  | { kind: 'task'; intent: 'submit-task'; success: false; params: TaskParams; message: string }
  | ({ kind: 'query'; intent: 'query-price' | 'query-plan' | 'query-both' } & DayQuery)
  | { kind: 'unknown'; intent: 'unknown'; message: string }
export interface ChatReply { engine: 'llm' | 'rules'; actions: ChatAction[] }
export interface Region { name: string; description: string; sites: number; behaviour: string }

export interface LlmInfo {
  presets: { id: string; name: string; baseUrl: string; model: string; keyUrl: string; models: string[] }[]
  settings: { enabled: boolean; provider: string; baseUrl: string; model: string; hasKey: boolean; keyHint: string }
}
export type LlmTest = { ok: true; ms: number; reply: string } | { ok: false; ms: number; error: string }

export type Profile = 'doc-example' | 'flat' | 'two-levels' | 'single-peak' | 'double-peak' | 'last-hour-peak' | 'random' | 'sample'

export interface DatasetSummary {
  id: number
  name: string
  description: string
  profile: Profile
  chargeMin: number
  dischargeMin: number
  granularity: number
  startOffset: number
  builtIn: boolean
  /** Region named when the dataset was made; tasks can use it. Empty when none. */
  region: string
  updatedAt: string
  dayCount: number
  slotsPerDay: number
}
export interface Dataset extends Omit<DatasetSummary, 'dayCount' | 'slotsPerDay'> {
  days: number[][]
}
export interface NewDataset {
  name: string
  description: string
  profile: Profile
  days: number
  granularity: number
  chargeMin: number
  dischargeMin: number
  startOffset: number
  seed: number
  /** Optional: a region name tasks can use, made together with the data. */
  region?: string
}
export interface DayPreview { date: string; prices: number[]; stages: Stage[] }
export interface Preview { days: DayPreview[]; strategies: PlanRow[] }
export interface DraftParams {
  days: number[][]
  chargeMin: number
  dischargeMin: number
  startOffset: number
}
export interface AppliedResult { success: boolean; batchId: number; dates: string[]; count: number }
export interface AlgorithmExample { prices: number[]; stages: Stage[]; chargeMin: number; dischargeMin: number; granularity: number }

export type Category = 'bug' | 'idea' | 'question' | 'praise'
export type FeedbackStatus = 'new' | 'checked' | 'resolved'
export interface Feedback {
  id: number
  name: string
  category: Category
  rating: number | null
  message: string
  status: FeedbackStatus
  adminNote: string
  createdAt: string
  updatedAt: string
  edited: boolean
  images: string[]
  owner?: string
}
export interface FeedbackInput {
  name: string
  category: Category
  rating: number | null
  message: string
}
export interface AdminFeedback {
  counts: Record<'all' | FeedbackStatus, number>
  items: Feedback[]
}

/** A random id for this browser. It is how the server knows which feedback is yours; it is not a login. */
export function userId(): string {
  const ok = (v: string | null): v is string => !!v && /^[A-Za-z0-9_-]{16,64}$/.test(v)
  try {
    const have = localStorage.getItem('uid')
    if (ok(have)) return have
    const made = crypto.randomUUID().replace(/-/g, '')
    localStorage.setItem('uid', made)
    return made
  } catch {
    return (sessionId ??= crypto.randomUUID().replace(/-/g, ''))
  }
}
let sessionId: string | undefined

const mine = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as object), 'x-user-id': userId() } })
const admin = (key: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as object), 'x-admin-key': key } })

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const d = (j as { detail?: unknown }).detail
    throw new Error(typeof d === 'string' ? d : d ? JSON.stringify(d) : `Request failed (${r.status})`)
  }
  return j as T
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  // Fastify refuses a JSON content type with no body, so the header goes only with a body.
  headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

/** The browser's own "today", so "today" and "yesterday" mean the same thing on the server and in the page. */
export const isoDay = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const api = {
  energySummary: () => call<EnergySummary>('/api/energy-saving/dashboard/energy-summary'),
  kpi: () => call<Kpi>('/api/energy-saving/dashboard/kpi'),
  energyCurves: () => call<EnergyCurves>('/api/energy-saving/dashboard/energy-curves'),
  submitTask: (userInput: string) => call<TaskResult>('/api/energy-saving/task/submit', send('POST', { userInput })),
  effect: (region: string, taskId: string) =>
    call<EnergyEffect>(`/api/energy-saving/effect?region=${encodeURIComponent(region)}&taskId=${encodeURIComponent(taskId)}`),
  decide: (id: string, accept: boolean) => call<TaskView>(`/api/energy-saving/tasks/${encodeURIComponent(id)}/decision`, send('POST', { accept })),
  task: (id: string) => call<TaskView>(`/api/energy-saving/tasks/${encodeURIComponent(id)}`),
  regions: () => call<Region[]>('/api/regions'),
  chat: (message: string) => call<ChatReply>('/api/energy-saving/chat', send('POST', { message, today: isoDay() })),
  queryDay: (day: string) => call<DayQuery>(`/api/energy-saving/query?day=${day}`),

  profiles: () => call<{ profile: Profile; description: string }[]>('/api/test-data/profiles'),
  datasets: () => call<DatasetSummary[]>('/api/test-data'),
  dataset: (id: number) => call<Dataset>(`/api/test-data/${id}`),
  createDataset: (d: NewDataset) => call<{ id: number }>('/api/test-data', send('POST', d)),
  updateDataset: (id: number, d: Partial<DraftParams> & { name?: string; description?: string; region?: string }) =>
    call<unknown>(`/api/test-data/${id}`, send('PUT', d)),
  duplicateDataset: (id: number) => call<{ id: number }>(`/api/test-data/${id}/duplicate`, send('POST')),
  deleteDataset: (id: number) => call<unknown>(`/api/test-data/${id}`, send('DELETE')),
  resetDatasets: () => call<unknown>('/api/test-data/reset', send('POST')),
  previewDataset: (id: number, draft?: DraftParams) =>
    call<Preview>(`/api/test-data/${id}/preview`, send('POST', { ...draft, baseDate: isoDay() })),
  applyDataset: (id: number) => call<AppliedResult>(`/api/test-data/${id}/apply`, send('POST', { baseDate: isoDay() })),
  algorithmExample: () => call<AlgorithmExample>('/api/algorithm/example'),

  myFeedback: () => call<Feedback[]>('/api/feedback/mine', mine()),
  sendFeedback: (f: FeedbackInput) => call<{ id: number }>('/api/feedback', mine(send('POST', f))),
  editFeedback: (id: number, f: Partial<FeedbackInput>) => call<unknown>(`/api/feedback/${id}`, mine(send('PUT', f))),
  deleteFeedback: (id: number) => call<unknown>(`/api/feedback/${id}`, mine(send('DELETE'))),
  addImage: (id: number, image: Blob) => {
    const fd = new FormData()
    fd.append('file', image, 'image')
    return call<{ id: string }>(`/api/feedback/${id}/images`, mine({ method: 'POST', body: fd }))
  },
  removeImage: (id: number, imageId: string) => call<unknown>(`/api/feedback/${id}/images/${imageId}`, mine(send('DELETE'))),

  adminFeedback: (key: string, status: string, q: string) =>
    call<AdminFeedback>(`/api/admin/feedback?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`, admin(key)),
  adminUpdate: (key: string, id: number, body: { status?: FeedbackStatus; adminNote?: string }) =>
    call<unknown>(`/api/admin/feedback/${id}`, admin(key, send('PUT', body))),
  llmGet: (key: string) => call<LlmInfo>('/api/admin/llm', admin(key)),
  llmSave: (key: string, b: { provider: string; baseUrl: string; model: string; enabled: boolean; apiKey?: string }) =>
    call<LlmInfo['settings']>('/api/admin/llm', admin(key, send('PUT', b))),
  llmTest: (key: string) => call<LlmTest>('/api/admin/llm/test', admin(key, send('POST'))),
  adminDelete: (key: string, id: number) => call<unknown>(`/api/admin/feedback/${id}`, admin(key, send('DELETE'))),
}

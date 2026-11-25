// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Regions and tasks of the dialog (design doc 2.3, 2.7, 3.4). A task row is made when the Network Agent has accepted the
 * task and gave it an id. The state of a task is read from the Network Agent by that id (A2A task states) and kept here;
 * a task with no final answer after the time limit becomes "timed_out". A2A states carry no percentage, so the
 * progress is the step reached: sent 20, working 60, completed 100.
 */
import type { EffectReport, Proposal, TaskState } from './api-types.js'
import type { Db } from './db.js'
import type { RateRange } from './intent.js'
import { SkillError, type RemoteTask, type Skill } from './skills/energy-saving/index.js'

export type { Proposal, TaskState } from './api-types.js'

/** The report of a finished task: what the dashboard shows, and the phase and simulation flag of the Network Agent. */
export interface Report extends EffectReport {
  businessPhase: string
  simulation: boolean
}

export interface TaskView {
  taskId: string
  region: string
  state: TaskState
  progress: number
  final: boolean
  error?: string
  createdAt: string
  report?: Report
  proposal?: Proposal
}

// There is no default region and no built-in region: the sentence names the region of a task, and the Network Agent knows its regions.
// The table holds the regions added with a test dataset (addRegion); the test regions of the stand-in Network Agent live in the tests.
const DATASET_REGION = 'Made with the test data'

export function initTaskTables(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS region(
      name TEXT PRIMARY KEY COLLATE NOCASE, description TEXT NOT NULL, sites INT NOT NULL, behaviour TEXT NOT NULL DEFAULT 'normal');
    CREATE TABLE IF NOT EXISTS task(
      id TEXT PRIMARY KEY, a2a_task_id TEXT, region TEXT NOT NULL, text TEXT NOT NULL, rate_mbps TEXT, reserve_ratio REAL,
      state TEXT NOT NULL, progress INT NOT NULL DEFAULT 0, error TEXT, report_json TEXT, proposal_json TEXT,
      created_at INT NOT NULL, finished_at INT);
  `)
  // Databases made by early builds have no a2a_task_id column yet.
  if (!(db.prepare('PRAGMA table_info(task)').all() as { name: string }[]).some((c) => c.name === 'a2a_task_id')) {
    db.exec('ALTER TABLE task ADD COLUMN a2a_task_id TEXT')
  }
  if (!(db.prepare('PRAGMA table_info(task)').all() as { name: string }[]).some((c) => c.name === 'proposal_json')) {
    db.exec('ALTER TABLE task ADD COLUMN proposal_json TEXT')
  }
  // The default, demo and test regions that earlier versions put in the table are removed, unless a task used them; the regions of
  // test datasets stay.
  db.prepare(`DELETE FROM region WHERE description NOT LIKE '${DATASET_REGION}%' AND NOT EXISTS (SELECT 1 FROM task WHERE task.region = region.name)`).run()
}

/** Add the region of a test dataset, one a task can name (a no-op when the name is already known, whatever its case). */
export function addRegion(db: Db, name: string, dataset: string): void {
  db.prepare('INSERT OR IGNORE INTO region VALUES(?,?,?,?)').run(name, `${DATASET_REGION} "${dataset}"`, 10, 'normal')
}

export const listRegions = (db: Db) =>
  db.prepare('SELECT name, description, sites, behaviour FROM region ORDER BY rowid').all() as {
    name: string
    description: string
    sites: number
    behaviour: string
  }[]

const timeoutMs = () => {
  // TODO: cancel the task on the MAE side when this time runs out
  const v = Number(process.env.TASK_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 120000
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export interface TaskInput {
  a2aTaskId: string
  text: string
  region: string
  rateMbps: RateRange[]
  reserveBackupRatio: number
}

/** Record a task the Network Agent has accepted. Returns the number the page uses: task-YYYYMMDD-NNNN. */
export function recordTask(db: Db, t: TaskInput, now = Date.now()): string {
  const d = new Date(now)
  const prefix = `task-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`
  const n = (db.prepare('SELECT COUNT(*) AS n FROM task WHERE id LIKE ?').get(`${prefix}%`) as { n: number }).n
  const id = `${prefix}${pad(n + 1, 4)}`
  const region = (db.prepare('SELECT name FROM region WHERE name=?').get(t.region) as { name: string } | undefined)?.name ?? t.region
  db.prepare('INSERT INTO task(id,a2a_task_id,region,text,rate_mbps,reserve_ratio,state,progress,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
    id,
    t.a2aTaskId,
    region,
    t.text,
    JSON.stringify(t.rateMbps),
    t.reserveBackupRatio,
    'sent',
    20,
    now,
  )
  return id
}

interface Row {
  id: string
  a2a_task_id: string | null
  region: string
  state: TaskState
  progress: number
  error: string | null
  report_json: string | null
  proposal_json: string | null
  created_at: number
  finished_at: number | null
}

const FINAL: TaskState[] = ['completed', 'failed', 'timed_out']

/** A2A task state to our state, and the step reached. */
function mapRemote(r: RemoteTask): { state: TaskState; progress?: number; error?: string; report?: Report; proposal?: Proposal } {
  switch (r.status.state) {
    case 'TASK_STATE_INPUT_REQUIRED':
      return { state: 'input_required', progress: 60, proposal: r.status.message?.parts?.[0]?.data as unknown as Proposal | undefined }
    case 'TASK_STATE_COMPLETED': {
      const data = r.artifacts?.[0]?.parts?.[0]?.data
      return { state: 'completed', progress: 100, report: data as unknown as Report | undefined }
    }
    case 'TASK_STATE_FAILED':
    case 'TASK_STATE_CANCELED':
    case 'TASK_STATE_REJECTED':
      return { state: 'failed', error: r.status.message?.parts?.[0]?.text ?? 'The Network Agent could not carry out the task' }
    case 'TASK_STATE_SUBMITTED':
      return { state: 'sent', progress: 20 }
    default:
      return { state: 'working', progress: 60 }
  }
}

/** Read a task: ask the Network Agent for news until the state is final, then keep the final state. */
export async function readTask(db: Db, id: string, skill: Pick<Skill, 'getTask'>, now = Date.now()): Promise<TaskView | undefined> {
  const row = db.prepare('SELECT * FROM task WHERE id=?').get(id) as Row | undefined
  if (!row) return undefined
  if (!FINAL.includes(row.state)) {
    let state = row.state
    let progress = row.progress
    let error: string | null = null
    let report: string | null = null
    let proposal: string | null = null
    if (now - row.created_at >= timeoutMs()) {
      state = 'timed_out'
      error = `No final answer within ${Math.round(timeoutMs() / 1000)} s`
    } else if (row.a2a_task_id) {
      try {
        const m = mapRemote(await skill.getTask(row.a2a_task_id))
        state = m.state
        progress = m.progress ?? progress
        error = m.error ?? null
        report = m.report ? JSON.stringify(m.report) : null
        proposal = m.proposal ? JSON.stringify(m.proposal) : null
      } catch {
        // The Network Agent could not be reached just now: keep what we know, the next read tries again.
      }
    }
    if (state !== row.state || progress !== row.progress) {
      const fin = FINAL.includes(state) ? now : null
      db.prepare('UPDATE task SET state=?, progress=?, error=?, report_json=?, proposal_json=?, finished_at=? WHERE id=?').run(state, progress, error, report, proposal, fin, id)
      Object.assign(row, { state, progress, error, report_json: report, proposal_json: proposal, finished_at: fin })
    }
  }
  return {
    taskId: row.id,
    region: row.region,
    state: row.state,
    progress: row.progress,
    final: FINAL.includes(row.state),
    ...(row.error ? { error: row.error } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.report_json ? { report: JSON.parse(row.report_json) as Report } : {}),
    ...(row.proposal_json ? { proposal: JSON.parse(row.proposal_json) as Proposal } : {}),
  }
}

/** The user's answer to a proposal. Only a task that waits for one can be answered; the Network Agent then goes on or ends the task. */
export async function answerProposal(db: Db, id: string, accept: boolean, skill: Pick<Skill, 'getTask' | 'decide'>): Promise<TaskView | undefined> {
  const row = db.prepare('SELECT a2a_task_id, state FROM task WHERE id=?').get(id) as { a2a_task_id: string | null; state: TaskState } | undefined
  if (!row) return undefined
  if (row.state !== 'input_required' || !row.a2a_task_id) throw new SkillError(409, 'The task is not waiting for an answer')
  await skill.decide(row.a2a_task_id, accept)
  return readTask(db, id, skill)
}

export async function recentTasks(db: Db, skill: Pick<Skill, 'getTask'>, limit = 50): Promise<TaskView[]> {
  const ids = db.prepare('SELECT id FROM task ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as { id: string }[]
  return Promise.all(ids.map(async (r) => (await readTask(db, r.id, skill))!))
}

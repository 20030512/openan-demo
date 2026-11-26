// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The access token of the MAE login is kept, and renewed once when the Network Agent refuses it (401): sending a task, reading its
 * state and answering a proposal all behave the same.
 */
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db.js'
import { allDayRate, rateRanges } from '../src/intent.js'
import { createSkill } from '../src/skills/energy-saving/index.js'
import { initTaskTables } from '../src/tasks.js'
import { createMockMae } from './support/mock-mae.js'
import { testFixtures } from './helpers.js'

function setup() {
  const db = openDb(':memory:')
  initTaskTables(db)
  testFixtures(db)
  db.prepare("INSERT INTO charge_discharge_strategy(batch_id,strategy_date,start_time,end_time,stage) VALUES(1,'2026-10-24','00:00','08:00','LOW')").run()
  let clock = 1_800_000_000_000
  const mae = createMockMae(db, () => clock)
  let logins = 0
  const counted = ((url: string, init?: RequestInit) => {
    if (String(url).endsWith('/oauth/token')) logins++
    return mae(url, init)
  }) as typeof fetch
  const skill = createSkill(db, counted, 'http://mae.mock')
  const task = { region: 'REGION-A', rateMbps: rateRanges(allDayRate(50)), reserveBackupRatio: 50 }
  return { skill, task, logins: () => logins, later: (ms: number) => (clock += ms) }
}

describe('access token', () => {
  it('is kept: a task and its state reads make one login', async () => {
    const s = setup()
    const id = await s.skill.submitTask(s.task)
    await s.skill.getTask(id)
    await s.skill.getTask(id)
    expect(s.logins()).toBe(1)
  })

  it('is renewed once when the Network Agent refuses it while the state is read', async () => {
    const s = setup()
    const id = await s.skill.submitTask(s.task)
    s.later(3 * 3600_000) // the Network Agent now treats the kept token as expired
    await expect(s.skill.getTask(id)).resolves.toBeTruthy()
    expect(s.logins()).toBe(2)
    await s.skill.getTask(id)
    expect(s.logins()).toBe(2)
  })

  it('is renewed once when the Network Agent refuses it while a task is sent', async () => {
    const s = setup()
    await s.skill.submitTask(s.task)
    s.later(3 * 3600_000)
    await expect(s.skill.submitTask(s.task)).resolves.toBeTruthy()
    expect(s.logins()).toBe(2)
  })

  it('is renewed once when the Network Agent refuses it while a proposal is answered', async () => {
    const s = setup()
    const id = await s.skill.submitTask(s.task)
    s.later(3 * 3600_000)
    // the stand-in has no proposal for this task: the answer may be refused for that reason, but only after the token was renewed
    await s.skill.decide(id, true).catch(() => undefined)
    expect(s.logins()).toBe(2)
  })
})

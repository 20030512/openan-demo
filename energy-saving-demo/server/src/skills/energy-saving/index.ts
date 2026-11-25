// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Energy-saving skill, task submission (design doc 3.2.2 and 6.5 to 6.12, same step names and error texts):
 *   Step 1 parameters (region, rate, reserve ratio: read by the LLM, see ../../llm.ts)
 *   Step 2 read the latest-batch charge/discharge strategy      (strategy-reader)
 *   Step 3 assemble the Task-T text                              (task-template-builder)
 *   Step 4 get the access token from the MAE login               (token-client)
 *   Step 5 send the task with the A2A-T interface                (a2a-client)
 * Feature 2 and 3 (price and plan query) are in routes/energy-saving.ts. The Network Agent behind the two clients is the one at
 * MAE_BASE_URL.
 */
import type { Db } from '../../db.js'
import type { TaskParams } from '../../intent.js'
import type { MaeFetch } from '../../mae/protocol.js'
import { A2AClient, type RemoteTask } from './a2a-client.js'
import { SkillError, TokenRefusedError } from './errors.js'
import { readLatestStrategy } from './strategy-reader.js'
import { buildTaskRequest } from './task-template-builder.js'
import { TokenClient } from './token-client.js'
import { message, type TraceLog } from '../../trace.js'

export { SkillError } from './errors.js'
export type { RemoteTask } from './a2a-client.js'

export interface Skill {
  /** Run steps 2 to 5 and return the id the Network Agent gave the task. */
  submitTask(params: TaskParams): Promise<string>
  /** The current state of a task at the Network Agent. */
  getTask(a2aTaskId: string): Promise<RemoteTask>
  /** Accept or reject the proposal of a task that waits for an answer. */
  decide(a2aTaskId: string, accept: boolean): Promise<void>
}

/** The log (pino-like, see trace.ts); off when none is given. */
export type SkillLog = TraceLog

export function createSkill(db: Db, maeFetch: MaeFetch, baseUrl: string, log?: SkillLog): Skill {
  const tokens = new TokenClient(maeFetch, baseUrl, log)
  const a2a = new A2AClient(maeFetch, baseUrl, log)
  /**
   * A call with the access token. The token of an earlier call is reused until it expires; when the Network Agent refuses it (401 or 403)
   * one new login is done and the call is made once more (a refused request created or changed nothing at the Network Agent).
   */
  const withToken = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await call(await tokens.getAccessToken())
    } catch (e) {
      if (!(e instanceof TokenRefusedError)) throw e
      log?.warn({ logger: 'mae.client' }, message('MAE refused the access token', {}, { cause: 'the token expired or was revoked', action: 'a new login is done and the call is made once more' }))
      return call(await tokens.getAccessToken(true))
    }
  }
  return {
    async submitTask(params) {
      const plan = readLatestStrategy(db)
      if (!plan.strategies.length) {
        log?.error({ logger: 'task' }, message('Task not built', {}, { cause: 'No charge/discharge strategy exists in the database yet.', action: 'import electricity prices first (the Save Strategy page, or the example data of a new database)' }))
        throw new SkillError(409, 'The charge/discharge strategy has not been generated, please import electricity price data first')
      }
      // Step 3: the parameters and the strategy combined in the populated Task-T template.
      const request = buildTaskRequest(params, plan)
      log?.info({ logger: 'task' }, message('Task-T built', { strategy_batch: plan.batchId, strategy_periods: plan.strategies.length, task_t_chars: request.text.length }))
      return await withToken((token) => a2a.send(request, token))
    },
    async decide(id, accept) {
      await withToken((token) => a2a.decide(id, accept, token))
    },
    async getTask(id) {
      return withToken((token) => a2a.getTask(id, token))
    },
  }
}

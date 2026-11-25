// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { Db } from '../../db.js'
import { mergeRows } from '../../strategy.js'

/** Strategy JSON: every row of the latest batch, FLAT included, no calculation. */
export interface ChargeDischargePlanJSON {
  batchId: number
  strategies: { strategyDate: string; startTime: string; endTime: string; stage: 'LOW' | 'FLAT' | 'PEAK' }[]
}

export function readLatestStrategy(db: Db): ChargeDischargePlanJSON {
  const batchId = (db.prepare('SELECT MAX(batch_id) AS b FROM charge_discharge_strategy').get() as { b: number | null }).b ?? 0
  const rows = db
    .prepare('SELECT strategy_date AS date, start_time, end_time, stage FROM charge_discharge_strategy WHERE batch_id=? ORDER BY id')
    .all(batchId) as { date: string; start_time: string; end_time: string; stage: 'LOW' | 'FLAT' | 'PEAK' }[]
  // One period per row, whichever app wrote the rows (the strategy app writes one row per price slot).
  const periods = mergeRows(rows.map((r) => ({ date: r.date, startTime: r.start_time, endTime: r.end_time, stage: r.stage })))
  return {
    batchId,
    strategies: periods.map((r) => ({ strategyDate: r.date, startTime: r.startTime, endTime: r.endTime, stage: r.stage })),
  }
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { db, transaction } from './db.js';
import { getSystemConfig } from './system-config.service.js';
import { getLatestBatchId } from './price-data.service.js';
import { isSupportedGranularity, runBatteryStrategySkill, BatteryStrategyInputError, type Stage, type StrategySegment } from '../battery-skill.js';
import type { ChargeDischargePlanItem } from '../types/energy-saving.js';

// Columns aliased to the camelCase names of ChargeDischargePlanItem (D2 §6.2).
const STRATEGY_COLUMNS =
  'SELECT id, batch_id AS batchId, strategy_date AS strategyDate, start_time AS startTime, end_time AS endTime, stage FROM charge_discharge_strategy';

export interface StrategyRowInput {
  strategyDate: string;
  startTime: string;
  endTime: string;
  stage: Stage;
}

export interface DailyStrategy {
  strategyDate: string;
  segments: StrategySegment[];
}

export interface GenerateStrategyResult {
  batchId: number;
  strategies: DailyStrategy[];
  // Dates whose prices have a single tier: no peak-shaving (D1 §2.4, §5).
  notExecuted: string[];
  warnings: string[];
}

export function saveStrategyBatch(batchId: number, rows: StrategyRowInput[]): void {
  const del = db.prepare('DELETE FROM charge_discharge_strategy WHERE batch_id = ?');
  const ins = db.prepare(
    'INSERT INTO charge_discharge_strategy (batch_id, strategy_date, start_time, end_time, stage) VALUES (?, ?, ?, ?, ?)'
  );
  transaction(() => {
    del.run(batchId);
    for (const r of rows) ins.run(batchId, r.strategyDate, r.startTime, r.endTime, r.stage);
  });
}

// The strategy always belongs to the latest price batch (D1 §2.4): if that import produced
// no strategy (e.g. single-tier days), the result is empty, never an older batch's strategy.
export function getLatestStrategyBatchId(): number {
  return getLatestBatchId();
}

export function getLatestStrategy(): ChargeDischargePlanItem[] {
  return db
    .prepare(`${STRATEGY_COLUMNS} WHERE batch_id = ? ORDER BY strategy_date, start_time`)
    .all(getLatestStrategyBatchId()) as unknown as ChargeDischargePlanItem[];
}

// D2 §3.3.5: latest batch for a date, FLAT removed (LOW/PEAK only).
export function getPlanByDate(date: string): ChargeDischargePlanItem[] {
  return db
    .prepare(`${STRATEGY_COLUMNS} WHERE batch_id = ? AND strategy_date = ? AND stage != 'FLAT' ORDER BY start_time`)
    .all(getLatestStrategyBatchId(), date) as unknown as ChargeDischargePlanItem[];
}

// Generate the strategy from the latest price batch (D1 generateStrategy; also run after an import).
// The algorithm is the battery-charge-discharge-strategy skill; this function adds storage.
export function generateStrategy(): GenerateStrategyResult {
  const config = getSystemConfig();
  if (!isSupportedGranularity(config.price_granularity)) {
    throw new Error('configure price granularity first');
  }
  const batchId = getLatestBatchId();
  if (batchId === 0) throw new Error('no price data');

  const prices = db
    .prepare('SELECT price_date AS date, time_slot AS timeSlot, price_value AS price FROM price_data WHERE batch_id = ?')
    .all(batchId) as Array<{ date: string; timeSlot: string; price: number }>;

  let result;
  try {
    result = runBatteryStrategySkill({
      prices,
      chargeMinutes: config.standby_duration,
      dischargeMinutes: config.discharge_duration,
      granularityHours: config.price_granularity,
    });
  } catch (e) {
    if (e instanceof BatteryStrategyInputError) throw new Error(e.message);
    throw e;
  }

  const strategies: DailyStrategy[] = result.strategies.map((d) => ({ strategyDate: d.strategyDate, segments: d.segments }));
  const rows: StrategyRowInput[] = strategies.flatMap((d) => d.segments.map((seg) => ({ strategyDate: d.strategyDate, ...seg })));

  // The strategy batch id is the price batch it came from (D1 §2.4); regeneration overwrites it.
  saveStrategyBatch(batchId, rows);
  return { batchId, strategies, notExecuted: result.notExecuted, warnings: result.warnings };
}

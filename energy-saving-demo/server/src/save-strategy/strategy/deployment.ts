// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Mapping of a strategy onto the sheets of the Deployment 错峰调整 import files
// (错峰调整按天配置 / 错峰调整按月配置): which date fills which sheet, the
// numbered segment rows, and the network-element rows. Pure data; writing the
// Excel workbook is left to the caller.

import type { Stage } from './strategy.js';

export type DeploymentTemplate = 'day' | 'month';

/** Weekday sheets in import-file order, index = JavaScript getDay() (Sunday first). */
export const DAY_SHEETS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
/** Month sheets in import-file order, index = month - 1. */
export const MONTH_SHEETS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

export interface StrategyRow {
  strategyDate: string;
  startTime: string;
  endTime: string;
  stage: Stage;
}

/** One row of a period sheet: 编号, 开始时间, 结束时间, 阶段. */
export interface DeploymentRow {
  no: number;
  start: string;
  end: string;
  stage: Stage;
}

export interface DeploymentSheets {
  /** Sheet name -> rows, in template sheet order; sheets without data are absent. */
  sheets: Array<{ sheet: string; date: string; rows: DeploymentRow[] }>;
  filled: string[];
  empty: string[];
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // local date, no UTC shift
}

const monthOf = (date: string): number => Number(date.split('-')[1]);

/**
 * Each sheet takes the strategy of one date: the latest date that falls on that
 * weekday (day template) or in that month (month template). Sheets without a
 * matching date stay empty unless `applyDateToEmpty` names a date to copy.
 * Consecutive segments with the same stage are merged and numbered from 1.
 */
export function mapToDeploymentSheets(
  rows: StrategyRow[],
  template: DeploymentTemplate,
  applyDateToEmpty?: string
): DeploymentSheets {
  const names = template === 'day' ? DAY_SHEETS : MONTH_SHEETS;
  const sheetOf = (date: string) => (template === 'day' ? DAY_SHEETS[weekdayOf(date)] : MONTH_SHEETS[monthOf(date) - 1]);

  const dateForSheet = new Map<string, string>();
  for (const r of rows) {
    const sheet = sheetOf(r.strategyDate);
    const current = dateForSheet.get(sheet);
    if (!current || r.strategyDate > current) dateForSheet.set(sheet, r.strategyDate);
  }

  const sheets: DeploymentSheets['sheets'] = [];
  const filled: string[] = [];
  const empty: string[] = [];
  for (const sheet of names) {
    const date = dateForSheet.get(sheet) ?? applyDateToEmpty;
    const segments = date ? rows.filter((r) => r.strategyDate === date) : [];
    if (!date || segments.length === 0) {
      empty.push(sheet);
      continue;
    }
    // One row per strategy record (one per price slot), as many rows as the price list.
    const rows2 = [...segments]
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s, i) => ({ no: i + 1, start: s.startTime, end: s.endTime, stage: s.stage }));
    sheets.push({ sheet, date, rows: rows2 });
    filled.push(sheet);
  }
  return { sheets, filled, empty };
}

export interface NetworkElementInput {
  name: string;
  generationMode: 'Fixed' | 'Dynamic';
  dischargeThreshold?: number | null;
  targetDuration?: number | null;
}

/** One row of the 网元列表 sheet: 网元名称, 错峰用电生效模式, 错峰放电停止门限, 目标备电时长/分钟. */
export interface NetworkElementRow {
  name: string;
  mode: '固定' | '动态';
  dischargeThreshold: number | null;
  targetDurationMinutes: number | null;
}

/** Fixed mode uses the discharge stop threshold, Dynamic mode the target backup duration. */
export function mapNetworkElements(nes: NetworkElementInput[]): NetworkElementRow[] {
  return nes.map((ne) => ({
    name: ne.name,
    mode: ne.generationMode === 'Dynamic' ? '动态' : '固定',
    dischargeThreshold: ne.generationMode === 'Fixed' ? (ne.dischargeThreshold ?? null) : null,
    targetDurationMinutes: ne.generationMode === 'Dynamic' ? (ne.targetDuration ?? null) : null,
  }));
}

/** Plain CSV of the strategy rows (secondary export). */
export function strategyCsv(rows: StrategyRow[]): string {
  return ['strategyDate,startTime,endTime,stage', ...rows.map((r) => `${r.strategyDate},${r.startTime},${r.endTime},${r.stage}`)].join('\n');
}

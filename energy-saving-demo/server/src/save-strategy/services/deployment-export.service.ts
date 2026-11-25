// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// A8 — the Deployment export (T-DAY / T-MONTH), built with ExcelJS. The workbook is made here, no template file is
// read: a network-element sheet and one sheet per weekday or month, with the column headers Deployment imports.
// Which rows go into which sheet comes from the battery-charge-discharge-strategy skill; this service only writes them.

import ExcelJS from 'exceljs';
import { listNetworkElements } from './network-element.service.js';
import { getLatestStrategy, getLatestStrategyBatchId } from './strategy.service.js';
import { DAY_SHEETS, MONTH_SHEETS, mapNetworkElements, mapToDeploymentSheets, strategyCsv } from '../battery-skill.js';

/** File name of each export, without the batch suffix. */
const EXPORT_NAMES: Record<'day' | 'month', string> = {
  day: '错峰调整按天配置',
  month: '错峰调整按月配置',
};
const NE_SHEET = '网元列表';
const NE_HEADERS = ['网元名称', '错峰用电生效模式', '错峰放电停止门限', '目标备电时长/分钟'];
const PERIOD_HEADERS = ['编号', '开始时间', '结束时间', '阶段'];

export interface ExportResult {
  filename: string;
  buffer: Buffer;
  summary: { filled: string[]; empty: string[] };
}

function headerRow(ws: ExcelJS.Worksheet, headers: string[], width: number): void {
  ws.addRow(headers).font = { bold: true };
  headers.forEach((_, i) => (ws.getColumn(i + 1).width = width));
}

export async function exportDeployment(kind: 'day' | 'month', applyDateToEmpty?: string): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();

  const ne = wb.addWorksheet(NE_SHEET);
  headerRow(ne, NE_HEADERS, 22);
  for (const row of mapNetworkElements(listNetworkElements())) {
    ne.addRow([row.name, row.mode, row.dischargeThreshold, row.targetDurationMinutes]);
  }

  // Every weekday or month gets its sheet, filled or not, in calendar order.
  const mapped = mapToDeploymentSheets(getLatestStrategy(), kind, applyDateToEmpty);
  const rowsOf = new Map(mapped.sheets.map((s) => [s.sheet, s.rows]));
  for (const name of kind === 'day' ? DAY_SHEETS : MONTH_SHEETS) {
    const ws = wb.addWorksheet(name);
    headerRow(ws, PERIOD_HEADERS, 12);
    for (const r of rowsOf.get(name) ?? []) ws.addRow([r.no, r.start, r.end, r.stage]);
  }

  return {
    filename: `${EXPORT_NAMES[kind]}-batch${getLatestStrategyBatchId()}.xlsx`,
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    summary: { filled: mapped.filled, empty: mapped.empty },
  };
}

export function exportCsv(): string {
  return strategyCsv(getLatestStrategy());
}

// "Time-of-Use Power Configuration by Month" export: a cover sheet, NEList with the network elements, and one sheet
// per month (named YYYY-MM) with the latest-batch strategy: No. | Start Time | End Time | Rate.
const NE_LIST_HEADERS = ['Ne Name', 'Staggered Power Effective Mode', 'Cutoff Threshold', 'Target Backup Power Use Duration (Minute)'];
const MONTH_SHEET_HEADERS = ['No.', 'Start Time', 'End Time', 'Rate'];

export async function exportTimeOfUseByMonth(today = new Date()): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  const cover = wb.addWorksheet('Cover');
  cover.getCell('A1').value = 'Time-of-Use Power Configuration by Month';
  cover.getCell('A1').font = { bold: true, size: 14 };
  cover.getCell('A2').value = 'Battery save strategy and network element configuration.';
  cover.getCell('A3').value = 'Version V1.0';
  cover.getColumn(1).width = 60;

  const neSheet = wb.addWorksheet('NEList');
  neSheet.addRow(NE_LIST_HEADERS).font = { bold: true };
  NE_LIST_HEADERS.forEach((_, i) => (neSheet.getColumn(i + 1).width = i === 0 ? 24 : 34));
  // Fixed / Dynamic as stored.
  for (const ne of listNetworkElements()) {
    neSheet.addRow([ne.name, ne.generationMode, ne.dischargeThreshold, ne.targetDuration ?? null]);
  }

  // Latest-batch strategy grouped by month, sorted by date then start time.
  const byMonth = new Map<string, ReturnType<typeof getLatestStrategy>>();
  for (const s of [...getLatestStrategy()].sort(
    (a, b) => a.strategyDate.localeCompare(b.strategyDate) || a.startTime.localeCompare(b.startTime)
  )) {
    const key = s.strategyDate.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(s);
  }
  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const ws = wb.addWorksheet(month);
    ws.addRow(MONTH_SHEET_HEADERS).font = { bold: true };
    byMonth.get(month)!.forEach((s, i) => ws.addRow([i + 1, s.startTime, s.endTime, s.stage]));
    ws.columns.forEach((c) => (c.width = 14));
  }

  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return {
    filename: `Time-of-Use Power Configuration by Month_${ymd}.xlsx`,
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    summary: { filled: ['NEList', ...months], empty: [] },
  };
}

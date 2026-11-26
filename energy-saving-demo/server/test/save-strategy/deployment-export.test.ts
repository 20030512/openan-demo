// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { db } from '../../src/save-strategy/services/db.js';
import { exportDeployment, exportTimeOfUseByMonth } from '../../src/save-strategy/services/deployment-export.service.js';
import { addNetworkElement } from '../../src/save-strategy/services/network-element.service.js';
import { saveStrategyBatch } from '../../src/save-strategy/services/strategy.service.js';

describe('A8 Deployment export (T-DAY)', () => {
  it('builds the NE sheet and the seven weekday sheets, no template file', async () => {
    db.exec('DELETE FROM charge_discharge_strategy; DELETE FROM network_element; DELETE FROM price_data;');
    // The strategy belongs to the latest price batch, so batch 1 must exist.
    db.prepare("INSERT INTO price_data (batch_id, price_date, time_slot, price_value) VALUES (1, '2026-10-19', '00:00-24:00', 0.5)").run();
    addNetworkElement({ name: 'NE-A', generationMode: 'Fixed', dischargeThreshold: 70 });
    addNetworkElement({ name: 'NE-B', generationMode: 'Dynamic', targetDuration: 120 });
    // 2026-10-19 is a Monday (星期一).
    saveStrategyBatch(1, [
      { strategyDate: '2026-10-19', startTime: '00:00', endTime: '08:00', stage: 'LOW' },
      { strategyDate: '2026-10-19', startTime: '08:00', endTime: '18:00', stage: 'FLAT' },
      { strategyDate: '2026-10-19', startTime: '18:00', endTime: '22:00', stage: 'PEAK' },
      { strategyDate: '2026-10-19', startTime: '22:00', endTime: '24:00', stage: 'LOW' },
    ]);

    const result = await exportDeployment('day');
    expect(result.filename).toBe('错峰调整按天配置-batch1.xlsx');
    expect(result.summary.filled).toEqual(['星期一']);
    expect(result.summary.empty).toHaveLength(6);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['网元列表', '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']);
    const cells = (name: string, rows: number[]) => rows.map((r) => [1, 2, 3, 4].map((c) => wb.getWorksheet(name)!.getCell(r, c).value));
    expect(cells('网元列表', [1, 2, 3])).toEqual([
      ['网元名称', '错峰用电生效模式', '错峰放电停止门限', '目标备电时长/分钟'],
      ['NE-A', '固定', 70, null],
      ['NE-B', '动态', null, 120],
    ]);
    expect(cells('星期一', [1, 2, 3, 4, 5])).toEqual([
      ['编号', '开始时间', '结束时间', '阶段'],
      [1, '00:00', '08:00', 'LOW'],
      [2, '08:00', '18:00', 'FLAT'],
      [3, '18:00', '22:00', 'PEAK'],
      [4, '22:00', '24:00', 'LOW'],
    ]);
    expect(wb.getWorksheet('星期二')!.rowCount).toBe(1);
  });

  it('builds the twelve month sheets for the month export', async () => {
    const result = await exportDeployment('month');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['网元列表', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']);
    expect(result.summary.filled).toEqual(['十月']);
  });
});

describe('Design §2.7.6 export (Time-of-Use Power Configuration by Month)', () => {
  it('writes the cover, NEList and one YYYY-MM sheet per month (No. | Start Time | End Time | Rate)', async () => {
    db.exec('DELETE FROM charge_discharge_strategy; DELETE FROM network_element; DELETE FROM price_data;');
    db.prepare("INSERT INTO price_data (batch_id, price_date, time_slot, price_value) VALUES (1, '2026-10-31', '00:00-24:00', 0.5)").run();
    addNetworkElement({ name: 'NE-A', generationMode: 'Fixed', dischargeThreshold: 70 });
    saveStrategyBatch(1, [
      { strategyDate: '2026-11-01', startTime: '00:00', endTime: '12:00', stage: 'LOW' },
      { strategyDate: '2026-10-31', startTime: '12:00', endTime: '24:00', stage: 'PEAK' },
      { strategyDate: '2026-10-31', startTime: '00:00', endTime: '12:00', stage: 'LOW' },
    ]);

    const result = await exportTimeOfUseByMonth(new Date(2026, 9, 24));
    expect(result.filename).toBe('Time-of-Use Power Configuration by Month_20261024.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name).slice(1)).toEqual(['NEList', '2026-10', '2026-11']);
    const rows = (name: string) =>
      wb.getWorksheet(name)!.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1));
    expect(rows('NEList')[0]).toEqual(['Ne Name', 'Staggered Power Effective Mode', 'Cutoff Threshold', 'Target Backup Power Use Duration (Minute)']);
    expect(rows('NEList')[1].slice(0, 3)).toEqual(['NE-A', 'Fixed', 70]);
    expect(rows('2026-10')).toEqual([
      ['No.', 'Start Time', 'End Time', 'Rate'],
      [1, '00:00', '12:00', 'LOW'],
      [2, '12:00', '24:00', 'PEAK'],
    ]);
    expect(rows('2026-11')).toEqual([
      ['No.', 'Start Time', 'End Time', 'Rate'],
      [1, '00:00', '12:00', 'LOW'],
    ]);
  });
});

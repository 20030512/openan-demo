// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import * as XLSX from 'xlsx';
import { assertSafeSheetJs } from '../../guard/high-risk.js';
import { db, transaction } from './db.js';
import { getSystemConfig, saveSystemConfig } from './system-config.service.js';
import { isSupportedGranularity, stageFor, validateDaySlots, type StrategySegment } from '../battery-skill.js';
import { generateStrategy } from './strategy.service.js';
import type { PriceDataItem } from '../types/energy-saving.js';

export interface ImportResult {
  success: boolean;
  count: number;
  batchId: number;
  message: string;
  strategies: Array<{ strategyDate: string; segments: StrategySegment[] }>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

// Parse an uploaded workbook/CSV into price rows.
// Expected columns: date (YYYY-MM-DD), time slot (HH:MM-HH:MM), price (number).
// CSV text is read as written (raw: true; otherwise "2026-10-20" turns into "10/20/26");
// a real Excel date cell is written as YYYY-MM-DD. Blank rows are skipped; any other
// row that does not match the format stops the import with its row number.
function parseRows(buffer: Buffer): Array<{ date: string; timeSlot: string; price: number }> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  // No formula and no high-risk command in any cell (the customer's list; ../../guard/high-risk.ts).
  assertSafeSheetJs(wb);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  const out: Array<{ date: string; timeSlot: string; price: number }> = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cells = [r[0], r[1], r[2]].map((c) => String(c ?? '').trim());
    if (cells.every((c) => c === '')) continue;
    const [date, timeSlot, priceText] = cells;
    const price = Number(priceText);
    if (!DATE.test(date) || !SLOT.test(timeSlot) || priceText === '' || !Number.isFinite(price)) {
      throw new Error(
        `wrong format in row ${i + 1}: expected date YYYY-MM-DD, time slot HH:MM-HH:MM and a numeric price (got "${cells.join('", "')}")`
      );
    }
    out.push({ date, timeSlot, price });
  }
  return out;
}

export async function importPriceData(buffer: Buffer, _filename: string): Promise<ImportResult> {
  const rows = parseRows(buffer);
  if (rows.length === 0) throw new Error('empty file');

  // The slot length comes from the file when every row has the same supported length;
  // the configured granularity is updated to it after a successful validation.
  const configured = getSystemConfig().price_granularity;
  const lengths = [...new Set(rows.map((r) => slotMinutes(r.timeSlot)))].sort((a, b) => a - b);
  if (lengths.length > 1) {
    throw new Error(`all price slots must have the same length; the file mixes ${lengths.join(', ')}-minute slots`);
  }
  if (!isSupportedGranularity(lengths[0] / 60)) {
    throw new Error(`price slots of ${lengths[0]} min are not supported; use 15, 30 or 60-minute slots`);
  }
  const detected = detectGranularity(rows);
  const granularity = detected ?? configured;
  if (!isSupportedGranularity(granularity)) throw new Error('configure price granularity first');

  // Validate per date.
  const dates = new Map<string, Array<{ timeSlot: string; price: number }>>();
  for (const r of rows) {
    if (!dates.has(r.date)) dates.set(r.date, []);
    dates.get(r.date)!.push({ timeSlot: r.timeSlot, price: r.price });
  }
  for (const [date, slots] of dates) {
    const errors = validateDaySlots(slots, granularity);
    if (errors.length) throw new Error(`parse failure for ${date}: ${errors.join('; ')}`);
  }

  const granularityNote: string[] = [];
  if (granularity !== configured) {
    saveSystemConfig({ price_granularity: granularity });
    granularityNote.push(`price slot length set to ${granularity * 60} min from the file`);
  }

  // batch_id = max + 1 for the whole import.
  const batchId = getLatestBatchId() + 1;
  const insert = db.prepare(
    'INSERT INTO price_data (batch_id, price_date, time_slot, price_value) VALUES (?, ?, ?, ?)'
  );
  transaction(() => {
    for (const r of rows) insert.run(batchId, r.date, r.timeSlot, r.price);
  });

  // Generate the strategy automatically from the batch just stored (D1 UC003).
  const generated = generateStrategy();
  const message = [
    'Import succeeded, strategy auto-generated',
    ...granularityNote,
    ...(generated.notExecuted.length
      ? [`peak-shaving not executed for ${generated.notExecuted.join(', ')} (single price tier)`]
      : []),
    ...generated.warnings,
  ].join('; ');
  return { success: true, count: rows.length, batchId, message, strategies: generated.strategies };
}

const slotMinutes = (timeSlot: string): number => {
  const [start, end] = timeSlot.split('-').map((t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  });
  return end - start;
};

/** The slot length of the file in hours, if all rows share one supported length; otherwise null. */
function detectGranularity(rows: Array<{ timeSlot: string }>): number | null {
  const lengths = new Set(rows.map((r) => slotMinutes(r.timeSlot)));
  if (lengths.size !== 1) return null;
  const hours = [...lengths][0] / 60;
  return isSupportedGranularity(hours) ? hours : null;
}

export function getLatestBatchId(): number {
  const row = db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS m FROM price_data').get() as { m: number };
  return row.m;
}

export function getPriceByDate(date: string): PriceDataItem[] {
  const max = getLatestBatchId();
  return db
    .prepare('SELECT id, batch_id AS batchId, price_date AS priceDate, time_slot AS timeSlot, price_value AS priceValue FROM price_data WHERE batch_id = ? AND price_date = ? ORDER BY time_slot')
    .all(max, date) as unknown as PriceDataItem[];
}

// All price rows of the latest batch (for the strategy configuration page).
export function getLatestPrices(): PriceDataItem[] {
  const max = getLatestBatchId();
  return db
    .prepare('SELECT id, batch_id AS batchId, price_date AS priceDate, time_slot AS timeSlot, price_value AS priceValue FROM price_data WHERE batch_id = ? ORDER BY price_date, time_slot')
    .all(max) as unknown as PriceDataItem[];
}

export { stageFor };

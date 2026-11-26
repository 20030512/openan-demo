// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Downloadable sample price file for the import (Strategy configuration page).
// Sheet 1 ("price") is in the import format and is what Import reads; sheet 2
// ("How to fill") explains the format. The prices are a sample tiered tariff
// (two-peak tiered tariff), not real data: the user replaces them before importing.

import ExcelJS from 'exceljs';

// Hour → sample price (CNY/kWh): 00–06 valley, 06–09 peak, 09–18 flat, 18–22 peak, 22–24 flat.
const SAMPLE_HOURLY = [
  0.25, 0.25, 0.25, 0.25, 0.25, 0.25,
  0.55, 0.55, 0.55,
  0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4,
  0.6, 0.6, 0.6, 0.6,
  0.3, 0.3,
];

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Seven days from yesterday, so "today" and "yesterday" queries find data and every weekday appears once. */
export function sampleDates(today = new Date()): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1 + i);
    return ymd(d);
  });
}

/** Slots of one day at the given granularity: "00:00-00:15" … "23:45-24:00". */
export function sampleSlots(granularityHours: number): Array<{ timeSlot: string; price: number }> {
  const step = Math.round(granularityHours * 60);
  const slots: Array<{ timeSlot: string; price: number }> = [];
  for (let m = 0; m < 24 * 60; m += step) {
    slots.push({ timeSlot: `${hhmm(m)}-${hhmm(m + step)}`, price: SAMPLE_HOURLY[Math.floor(m / 60)] });
  }
  return slots;
}

export async function buildSamplePriceWorkbook(today = new Date(), granularityHours = 0.5): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('price');
  ws.columns = [
    { header: 'date', key: 'date', width: 14 },
    { header: 'time_slot', key: 'time_slot', width: 14 },
    { header: 'price', key: 'price', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  const slots = sampleSlots(granularityHours);
  for (const date of sampleDates(today)) {
    for (const s of slots) ws.addRow({ date, time_slot: s.timeSlot, price: s.price });
  }
  // Keep date and time slot as text so Excel does not turn them into date/time values.
  ws.getColumn('date').numFmt = '@';
  ws.getColumn('time_slot').numFmt = '@';
  ws.getColumn('price').numFmt = '0.00';
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  [
    'Sample electricity price file — the prices are SAMPLE values (two-peak tiered tariff). Replace them with the real prices.',
    '',
    'Only the first sheet ("price") is imported. Keep the header row: date, time_slot, price.',
    'date: YYYY-MM-DD (text), e.g. 2026-10-23.',
    'time_slot: HH:MM-HH:MM (text). Per date the slots must be continuous and cover 00:00-24:00; the last slot ends at 24:00.',
    `Slot length must equal the "Price granularity" on the page. This file: ${granularityHours} h = ${slots.length} rows per day ` +
      '(0.25 h = 96, 0.5 h = 48, 1 h = 24).',
    'price: a number (CNY/kWh).',
    'Several dates can be imported at once; every import becomes a new batch and only the latest batch is used.',
    'The strategy is generated automatically after the import (charge = LOW, discharge = PEAK, no action = FLAT).',
  ].forEach((line, i) => {
    help.getCell(`A${i + 1}`).value = line;
    if (i === 0) help.getCell(`A${i + 1}`).font = { bold: true };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { validateDaySlots } from '../../src/save-strategy/battery-skill.js';
import { describe, expect, it } from 'vitest';
import { importPriceData } from '../../src/save-strategy/services/price-data.service.js';
import { buildSamplePriceWorkbook, sampleDates } from '../../src/save-strategy/services/sample-price.service.js';
import { generateStrategy, getLatestStrategy, getPlanByDate } from '../../src/save-strategy/services/strategy.service.js';
import { getSystemConfig, saveSystemConfig } from '../../src/save-strategy/services/system-config.service.js';

// One day in half-hour slots as an import CSV; price(h) gives the price of hour h.
function csvDay(date: string, price: (h: number) => number): Buffer {
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const rows = Array.from({ length: 48 }, (_, i) => `${date},${t(i * 30)}-${t(i * 30 + 30)},${price(Math.floor(i / 2))}`);
  return Buffer.from(['date,time_slot,price', ...rows].join('\n'));
}

const tiered = (h: number) => (h < 6 ? 0.25 : h >= 18 && h < 22 ? 0.6 : 0.4);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hours = (segments: Array<{ startTime: string; endTime: string }>) =>
  segments.reduce((sum, s) => sum + (minutes(s.endTime) - minutes(s.startTime)) / 60, 0);

describe('downloadable sample price file', () => {
  it('imports as is: 7 days from yesterday, YYYY-MM-DD dates, a strategy for every day', async () => {
    saveSystemConfig({ standby_duration: 360, discharge_duration: 240, price_granularity: 0.5 });
    const today = new Date(2026, 9, 23);
    const result = await importPriceData(await buildSamplePriceWorkbook(today), 'price_sample.xlsx');
    expect(result.count).toBe(7 * 48);
    expect(result.strategies.map((s) => s.strategyDate)).toEqual(sampleDates(today));
    expect(sampleDates(today)[0]).toBe('2026-10-22'); // yesterday
  });

  it.each([0.25, 1])('imports at granularity %s h with the matching number of rows', async (g) => {
    saveSystemConfig({ price_granularity: g });
    const result = await importPriceData(await buildSamplePriceWorkbook(new Date(2026, 9, 23), g), 'sample.xlsx');
    expect(result.count).toBe(7 * (24 / g));
    expect(result.strategies).toHaveLength(7);
    saveSystemConfig({ price_granularity: 0.5 });
  });

  it('takes the slot length from the file and updates the setting', async () => {
    saveSystemConfig({ price_granularity: 0.5 });
    const result = await importPriceData(await buildSamplePriceWorkbook(new Date(2026, 9, 23), 1), 'hourly.xlsx');
    expect(result.count).toBe(7 * 24);
    expect(result.message).toMatch(/price slot length set to 60 min from the file/);
    expect(getSystemConfig().price_granularity).toBe(1);
    saveSystemConfig({ price_granularity: 0.5 });
  });

  it('names the problem for mixed, unsupported and duplicate slots', () => {
    expect(validateDaySlots([{ timeSlot: '00:00-00:30' }, { timeSlot: '00:00-00:30' }], 0.5)).toEqual(['slot "00:00-00:30" appears twice']);
    expect(validateDaySlots([{ timeSlot: '00:00-01:00' }], 0.5)[0]).toMatch(/is 60 min long/);
  });

  it('rejects a malformed row with its row number instead of skipping it', async () => {
    const bad = Buffer.from('date,time_slot,price\n2026-10-20,00:00-24:00,abc\n');
    await expect(importPriceData(bad, 'bad.csv')).rejects.toThrow(/row 2/);
  });
});

describe('strategy follows the latest price import', () => {
  it('generates on import, regenerates with the current durations, and never shows an older batch', async () => {
    saveSystemConfig({ standby_duration: 360, discharge_duration: 240, price_granularity: 0.5 });

    const first = await importPriceData(csvDay('2026-10-19', tiered), 'day1.csv');
    expect(hours(getLatestStrategy().filter((r) => r.stage === 'PEAK'))).toBe(4);

    // Regenerate uses the latest batch with the durations saved now.
    saveSystemConfig({ discharge_duration: 120 });
    expect(generateStrategy().batchId).toBe(first.batchId);
    expect(hours(getLatestStrategy().filter((r) => r.stage === 'PEAK'))).toBe(2);

    // A new import whose day has a single price: no strategy for batch 2, and
    // batch 1's strategy must not be shown in its place.
    const second = await importPriceData(csvDay('2026-10-20', () => 0.5), 'flat.csv');
    expect(second.batchId).toBe(first.batchId + 1);
    expect(second.message).toMatch(/peak-shaving not executed for 2026-10-20/);
    // §2.7.1.9: a single-tier day is all FLAT, one record per price slot (48 at 30 min).
    const flat = getLatestStrategy();
    expect(flat).toHaveLength(48);
    expect(flat.every((r) => r.strategyDate === '2026-10-20' && r.stage === 'FLAT')).toBe(true);
    expect([flat[0].startTime, flat[47].endTime]).toEqual(['00:00', '24:00']);
    expect(getPlanByDate('2026-10-19')).toEqual([]);
  });
});

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { mapToDeploymentSheets, runBatteryStrategySkill, validateDaySlots } from '../../src/save-strategy/battery-skill.js';

// Two-peak tiered tariff in half-hour slots: valley 00-06, peak 06-09 and 18-22, flat otherwise.
function tieredDay(date: string) {
  const price = (h: number) => (h < 6 ? 0.25 : h < 9 ? 0.55 : h < 18 ? 0.4 : h < 22 ? 0.6 : 0.3);
  return Array.from({ length: 48 }, (_, i) => {
    const m = i * 30;
    const t = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    return { date, timeSlot: `${t(m)}-${t(m + 30)}`, price: price(Math.floor(m / 60)) };
  });
}

describe('battery-charge-discharge-strategy skill', () => {
  it('plans every day and covers 00:00-24:00', () => {
    const r = runBatteryStrategySkill({
      prices: [...tieredDay('2026-10-19'), ...tieredDay('2026-10-20')],
      chargeMinutes: 480,
      dischargeMinutes: 240,
      granularityHours: 0.5,
    });
    expect(r.strategies.map((d) => d.strategyDate)).toEqual(['2026-10-19', '2026-10-20']);
    for (const d of r.strategies) {
      expect(d.segments[0].startTime).toBe('00:00');
      expect(d.segments.at(-1)!.endTime).toBe('24:00');
    }
    expect(r.warnings).toEqual([]);
    // One strategy record per price slot: 48 price rows per day → 48 records.
    for (const d of r.strategies) {
      expect(d.segments).toHaveLength(48);
      expect(d.segments.every((s, i) => i === 0 || s.startTime === d.segments[i - 1].endTime)).toBe(true);
    }
  });

  it('reports a single-tier day as not executed and rounds durations with a warning', () => {
    const flat = tieredDay('2026-10-21').map((s) => ({ ...s, price: 0.5 }));
    const r = runBatteryStrategySkill({ prices: flat, chargeMinutes: 540, dischargeMinutes: 350, granularityHours: 0.5 });
    expect(r.notExecuted).toEqual(['2026-10-21']);
    expect(r.dischargeHours).toBe(6); // 350 min / 30 min = 11.67 → 12 slots
    expect(r.warnings[0]).toMatch(/whole 30-minute price slots/);
  });

  it('counts durations in price slots (design §2.7.1.4): 390 min at 30-minute slots is 6.5 h', () => {
    const r = runBatteryStrategySkill({ prices: tieredDay('2026-10-21'), chargeMinutes: 480, dischargeMinutes: 390, granularityHours: 0.5 });
    expect(r.dischargeHours).toBe(6.5);
    expect(r.warnings).toEqual([]);
    // One strategy record per price slot: 48 price rows per day → 48 records.
    for (const d of r.strategies) {
      expect(d.segments).toHaveLength(48);
      expect(d.segments.every((s, i) => i === 0 || s.startTime === d.segments[i - 1].endTime)).toBe(true);
    }
  });

  it('rejects broken slots and bad durations with a code', () => {
    const broken = tieredDay('2026-10-22').filter((_, i) => i !== 5);
    expect(() => runBatteryStrategySkill({ prices: broken, chargeMinutes: 480, dischargeMinutes: 240, granularityHours: 0.5 })).toThrow(/continuity/);
    expect(() => runBatteryStrategySkill({ prices: tieredDay('2026-10-22'), chargeMinutes: 0, dischargeMinutes: 240, granularityHours: 0.5 })).toThrow(/positive/);
    expect(validateDaySlots([{ timeSlot: '00:00-24:00' }], 0.4)).toHaveLength(1);
  });

  it('maps the latest matching date onto each Deployment sheet', () => {
    const rows = [
      { strategyDate: '2026-10-19', startTime: '00:00', endTime: '12:00', stage: 'LOW' as const },
      { strategyDate: '2026-10-19', startTime: '12:00', endTime: '24:00', stage: 'PEAK' as const },
      { strategyDate: '2026-10-26', startTime: '00:00', endTime: '24:00', stage: 'FLAT' as const },
    ];
    const day = mapToDeploymentSheets(rows, 'day'); // both dates are Mondays
    expect(day.filled).toEqual(['星期一']);
    expect(day.sheets[0]).toMatchObject({ date: '2026-10-26', rows: [{ no: 1, start: '00:00', end: '24:00', stage: 'FLAT' }] });
    expect(mapToDeploymentSheets(rows, 'month').filled).toEqual(['十月']);
  });
});

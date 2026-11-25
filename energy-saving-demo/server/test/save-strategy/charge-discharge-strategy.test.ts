// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { generateDailyStrategy, stageFor, toHourlyPrices } from '../../src/save-strategy/services/charge-discharge-strategy.js';

describe('stageFor (Deployment template meaning)', () => {
  it('charge → LOW, discharge → PEAK, flat → FLAT', () => {
    expect(stageFor('charge')).toBe('LOW');
    expect(stageFor('discharge')).toBe('PEAK');
    expect(stageFor('flat')).toBe('FLAT');
  });
});

describe('generateDailyStrategy', () => {
  it('one distinct price → not executed, the whole day is FLAT (§2.7.1.9)', () => {
    const r = generateDailyStrategy(Array(24).fill(0.5), 4, 5);
    expect(r.plan).toBe('none');
    expect(r.reason).toBe('peak-shaving not executed');
    expect(r.segments).toEqual([{ startTime: '00:00', endTime: '24:00', stage: 'FLAT' }]);
  });

  it('two distinct prices → no FLAT entries', () => {
    const prices = [
      0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
      0.9, 0.9, 0.9, 0.9,
      0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
    ];
    const r = generateDailyStrategy(prices, 4, 5);
    expect(r.plan).not.toBe('none');
    expect(r.segments.every((s) => s.stage !== 'FLAT')).toBe(true);
  });

  it('one discharge: the charge goes to the cheapest window (the last P hours only block discharge)', () => {
    const prices = Array(24).fill(0.5);
    [8, 9, 10, 11].forEach((h) => (prices[h] = 1.0));
    for (let h = 19; h < 24; h++) prices[h] = 0.1;
    const r = generateDailyStrategy(prices, 4, 5);
    // Discharge 08–12; the cheapest 5 h are 19–24.
    expect(r.plan).toBe('A');
    expect(r.chargeCount).toBe(1);
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '08:00', endTime: '12:00', stage: 'PEAK' },
      { startTime: '19:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('one discharge: the charge is NOT forced into the last P hours when cheaper hours exist (2026-10-14)', () => {
    const prices = [0.455, 0.432, 0.412, 0.406, 0.403, 0.413, 0.418, 0.289, 0.002, 0.062, 0.063, 0.052, 0.064, 0.061,
      0.142, 0.32, 0.356, 0.395, 0.385, 0.341, 0.256, 0.353, 0.231, 0.203];
    const r = generateDailyStrategy(prices, 7, 8);
    // Discharge 00–07 (the night peak); the cheapest 8 h are 07–15, not the last 8 h 16–24.
    expect(r.plan).toBe('A');
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '00:00', endTime: '07:00', stage: 'PEAK' },
      { startTime: '07:00', endTime: '15:00', stage: 'LOW' },
    ]);
  });

  it('covers the whole day 00:00–24:00 contiguously and merged', () => {
    const prices = [
      0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.3, 0.4,
      1.0, 1.0, 1.0, 1.0,
      0.5, 0.4, 0.3, 0.2, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
    ];
    const segs = generateDailyStrategy(prices, 4, 5).segments;
    expect(segs[0].startTime).toBe('00:00');
    expect(segs[segs.length - 1].endTime).toBe('24:00');
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].endTime).toBe(segs[i + 1].startTime);
      expect(segs[i].stage).not.toBe(segs[i + 1].stage);
    }
  });

  it('one discharge stops before the last P hours, even if a later window is more expensive', () => {
    const prices = [...Array(15).fill(0.5), 1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 0.1, 0.1, 0.1];
    // One discharge slot (plan B needs two). The most expensive hour is 20:00 (1.2), but with
    // M = 4 h it may not cover 20–24, so the discharge is the earliest 1.0 hour, 15–16. The charge
    // is the cheapest split around it: 00–01 + 21–24 (the discharge between them).
    const r = generateDailyStrategy(prices, 1, 4);
    expect(r.plan).toBe('A');
    expect(r.chargeCount).toBe(2);
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '00:00', endTime: '01:00', stage: 'LOW' },
      { startTime: '15:00', endTime: '16:00', stage: 'PEAK' },
      { startTime: '21:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('two-tier day labels every hour outside the windows by its own price tier', () => {
    const prices = [...Array(6).fill(0.3), ...Array(6).fill(0.9), ...Array(12).fill(0.3)];
    const r = generateDailyStrategy(prices, 1, 1);
    expect(r.segments).toEqual([
      { startTime: '00:00', endTime: '06:00', stage: 'LOW' },
      { startTime: '06:00', endTime: '12:00', stage: 'PEAK' },
      { startTime: '12:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('never puts two discharges between two charges (C-D-D-C is not allowed)', () => {
    // Two-peak tiered tariff in 30-min slots, charge 8 h (16 slots), discharge 6.5 h (13 slots).
    const hourly = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.55, 0.55, 0.55, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.6, 0.6, 0.6, 0.6, 0.3, 0.3];
    const prices = hourly.flatMap((p) => [p, p]);
    const r = generateDailyStrategy(prices, 13, 16, 0.5);
    const stages = r.segments.filter((x) => x.stage !== 'FLAT').map((x) => x.stage);
    const lows = stages.flatMap((st, i) => (st === 'LOW' ? [i] : []));
    for (let k = 1; k < lows.length; k++) {
      expect(stages.slice(lows[k - 1] + 1, lows[k]).filter((st) => st === 'PEAK')).toHaveLength(1);
    }
    expect(stages.join(' ')).not.toMatch(/LOW PEAK PEAK LOW/);
  });

  it('two discharges with one charge window (2D+1C); last phase is a discharge, so the last slot charges', () => {
    const prices = Array(24).fill(0.6);
    for (let h = 0; h < 6; h++) prices[h] = 0.1;
    [8, 9, 13, 14].forEach((h) => (prices[h] = 1.2));
    const r = generateDailyStrategy(prices, 4, 5);
    expect(r.plan).toBe('B');
    expect(r.chargeCount).toBe(1);
    expect(r.lastSlotCharge).toBe(true);
    // Chosen with profit 4.3; the last slot 23:00–24:00 (0.6) is then charged → 3.7.
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '00:00', endTime: '05:00', stage: 'LOW' },
      { startTime: '08:00', endTime: '10:00', stage: 'PEAK' },
      { startTime: '13:00', endTime: '15:00', stage: 'PEAK' },
      { startTime: '23:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('composition, no score: the larger discharge price sum wins, one discharge on a tie', () => {
    const prices = Array(24).fill(0.5);
    [10, 11, 14].forEach((h) => (prices[h] = 1.0));
    prices[0] = 0.1;
    prices[1] = 0.1;
    const r = generateDailyStrategy(prices, 2, 2);
    // A: discharge 10–12 (2.0). B: discharges 10 + 14 (2.0). Discharge sums tie → A, whose cheapest
    // charge is 00–02. The last stage is then a discharge, so 23:00–24:00 charges (Step 3.5).
    expect(r.plan).toBe('A');
    expect(r.lastSlotCharge).toBe(true);
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '00:00', endTime: '02:00', stage: 'LOW' },
      { startTime: '10:00', endTime: '12:00', stage: 'PEAK' },
      { startTime: '23:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('Step 3.5 scans back from 24:00: a two-tier PEAK label at the end also makes the last slot charge', () => {
    const prices = Array(24).fill(0.3);
    [8, 12, 22, 23].forEach((h) => (prices[h] = 0.9));
    const r = generateDailyStrategy(prices, 2, 1);
    // Two discharges 08 + 12; outside the windows the two-tier rule labels 22–24 PEAK by price,
    // so the first non-FLAT stage from the end is PEAK and 23:00–24:00 becomes LOW.
    expect(r.plan).toBe('B');
    expect(r.lastSlotCharge).toBe(true);
    expect(r.segments.slice(-2)).toEqual([
      { startTime: '22:00', endTime: '23:00', stage: 'PEAK' },
      { startTime: '23:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('a plan that already ends with a charge is left as it is', () => {
    const prices = Array(24).fill(0.5);
    [8, 9, 10, 11].forEach((h) => (prices[h] = 1.0));
    for (let h = 19; h < 24; h++) prices[h] = 0.1;
    const r = generateDailyStrategy(prices, 4, 5);
    expect(r.lastSlotCharge).toBeUndefined();
    expect(r.segments.at(-1)).toEqual({ startTime: '19:00', endTime: '24:00', stage: 'LOW' });
  });

  it('slides in price slots: G = 0.5, discharge 3 slots (1.5 h), charge 4 slots (2 h)', () => {
    const prices = Array(48).fill(0.6);
    [18, 19, 20].forEach((i) => (prices[i] = 1.2)); // 09:00–10:30
    for (let i = 44; i < 48; i++) prices[i] = 0.2; // 22:00–24:00 (the reserved last 2 h)
    const r = generateDailyStrategy(prices, 3, 4, 0.5);
    expect(r.plan).toBe('A');
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '09:00', endTime: '10:30', stage: 'PEAK' },
      { startTime: '22:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('tail handling, gap ≥ 4 h: the last discharge moves 2 h earlier; M sits between the discharges', () => {
    const prices = Array(24).fill(0.5);
    for (let h = 0; h < 6; h++) prices[h] = 0.1;
    [8, 9].forEach((h) => (prices[h] = 1.0));
    [20, 21, 22, 23].forEach((h) => (prices[h] = 1.2));
    const r = generateDailyStrategy(prices, 6, 6);
    // Two discharges 08–10 + 20–24 (gap 10 h) → 08–10 + 18–22, and 22–24 charges (not in M).
    // The 22–24 charge counts as a charge, so M (6 h) must have exactly one discharge between it
    // and 22–24: the cheap night 00–06 would leave two, so M goes to 10–16.
    expect(r.plan).toBe('B');
    expect(r.tailShifted).toBe(true);
    expect(r.chargeCount).toBe(2);
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '08:00', endTime: '10:00', stage: 'PEAK' },
      { startTime: '10:00', endTime: '16:00', stage: 'LOW' },
      { startTime: '18:00', endTime: '22:00', stage: 'PEAK' },
      { startTime: '22:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('tail handling, gap < 4 h: both discharges move 2 h earlier; if M cannot fit between them, one discharge is used', () => {
    const prices = Array(24).fill(0.5);
    for (let h = 0; h < 6; h++) prices[h] = 0.1;
    [15, 16].forEach((h) => (prices[h] = 1.0));
    [20, 21, 22, 23].forEach((h) => (prices[h] = 1.2));
    const r = generateDailyStrategy(prices, 6, 4);
    // Two discharges 15–17 + 20–24 (gap 3 h) → 13–15 + 18–22 with 22–24 charging. M = 4 h would have
    // to sit between 15 and 18 (3 h), so two discharges are infeasible → one discharge 11–17 with
    // the cheapest charge 00–04, and 23:00–24:00 charges because the day would end discharging.
    expect(r.plan).toBe('A');
    expect(r.segments.filter((x) => x.stage !== 'FLAT')).toEqual([
      { startTime: '00:00', endTime: '04:00', stage: 'LOW' },
      { startTime: '11:00', endTime: '17:00', stage: 'PEAK' },
      { startTime: '23:00', endTime: '24:00', stage: 'LOW' },
    ]);
  });

  it('regression 2026-10-18: no C-D-D-C through the tail charge', () => {
    // Real hourly prices of 2026-10-18 (batch #64); charge 8 h, discharge 390 min = 7 slots.
    const prices = [0.38719, 0.34415, 0.39174, 0.39038, 0.39866, 0.39802, 0.36463, 0.21457, 0.00204, 0.01143, 0.02868, 0.064,
      0.0412, 0.25053, 0.1515, 0.4095, 0.43612, 0.433, 0.43958, 0.43843, 0.44751, 0.45036, 0.43286, 0.43393];
    const r = generateDailyStrategy(prices, 7, 8);
    // Before the fix: LOW 05–13, PEAK 13–14, PEAK 16–22, LOW 22–24 (two discharges between two charges).
    // One discharge 00–07; the charge goes to the cheap midday 07–15 (not the last 8 h).
    expect(r.plan).toBe('A');
    expect(r.segments).toEqual([
      { startTime: '00:00', endTime: '07:00', stage: 'PEAK' },
      { startTime: '07:00', endTime: '15:00', stage: 'LOW' },
      { startTime: '15:00', endTime: '24:00', stage: 'FLAT' },
    ]);
  });

  it('plan B alternates discharge and charge (discharge first)', () => {
    const prices = Array(24).fill(0.6);
    [4, 5, 13, 14].forEach((h) => (prices[h] = 1.2));
    [8, 9, 18, 19, 20].forEach((h) => (prices[h] = 0.2));
    const r = generateDailyStrategy(prices, 4, 5);
    expect(r.plan).toBe('B');
    expect(r.segments.filter((s) => s.stage !== 'FLAT')).toEqual([
      { startTime: '04:00', endTime: '06:00', stage: 'PEAK' },
      { startTime: '08:00', endTime: '10:00', stage: 'LOW' },
      { startTime: '13:00', endTime: '15:00', stage: 'PEAK' },
      { startTime: '18:00', endTime: '21:00', stage: 'LOW' },
    ]);
  });

  it('prices every hour a slot covers and averages half-hour slots', () => {
    const slots = [
      { timeSlot: '00:00-02:00', price: 0.2 },
      { timeSlot: '02:00-02:30', price: 0.4 },
      { timeSlot: '02:30-03:00', price: 0.6 },
      { timeSlot: '03:00-24:00', price: 1.0 },
    ];
    const hourly = toHourlyPrices(slots);
    expect(hourly.slice(0, 4)).toEqual([0.2, 0.2, 0.5, 1.0]);
    expect(hourly).toHaveLength(24);
  });

  it('refuses a day with an hour that has no price', () => {
    expect(() => toHourlyPrices([{ timeSlot: '00:00-12:00', price: 0.2 }])).toThrow(/no price/);
  });
});

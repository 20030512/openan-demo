// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Tiered electricity price input: one row per date and time slot.

export interface PriceSlot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM-HH:MM, e.g. "00:00-00:30"; the last slot ends at 24:00 */
  timeSlot: string;
  price: number;
}

const toMinutes = (t: string): number => {
  const [h, m] = t.trim().split(':').map(Number);
  return h * 60 + m;
};

const toTime = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Price slot lengths the skill accepts, in hours (15, 30 or 60 minutes). */
export const GRANULARITY_OPTIONS = [0.25, 0.5, 1] as const;

export function isSupportedGranularity(hours: number): boolean {
  return (GRANULARITY_OPTIONS as readonly number[]).includes(hours);
}

/** Group the price rows by date (dates in ascending order). */
export function groupByDate(rows: PriceSlot[]): Map<string, PriceSlot[]> {
  const byDate = new Map<string, PriceSlot[]>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  return byDate;
}

/**
 * Check one day's slots: continuous (each end is the next start), every slot as
 * long as the granularity, covering 00:00 to 24:00. Returns the problems found.
 */
export function validateDaySlots(slots: Array<{ timeSlot: string }>, granularityHours: number): string[] {
  if (!isSupportedGranularity(granularityHours)) {
    return [`price granularity must be one of ${GRANULARITY_OPTIONS.join(', ')} h`];
  }
  const slotMinutes = Math.round(granularityHours * 60);
  const sorted = [...slots].sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  let expected = 0;
  for (const { timeSlot } of sorted) {
    const parts = timeSlot.split('-');
    if (parts.length !== 2 || !/^\d{2}:\d{2}$/.test(parts[0].trim()) || !/^\d{2}:\d{2}$/.test(parts[1].trim())) {
      return [`slot "${timeSlot}" is not HH:MM-HH:MM`];
    }
    const [start, end] = parts.map(toMinutes);
    if (end - start !== slotMinutes) {
      return [`slot "${timeSlot}" is ${end - start} min long; this file uses ${slotMinutes}-minute slots`];
    }
    if (start === expected - slotMinutes) return [`slot "${timeSlot}" appears twice`];
    if (start !== expected) {
      return [`slot "${timeSlot}" breaks continuity (expected start ${toTime(expected)})`];
    }
    expected += slotMinutes;
  }
  if (expected !== 24 * 60) return ['slots do not cover 00:00-24:00'];
  return [];
}

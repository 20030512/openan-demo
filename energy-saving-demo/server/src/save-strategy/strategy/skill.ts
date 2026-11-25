// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// Atomic skill: battery-charge-discharge-strategy.
// Input: tiered electricity prices (one row per date and time slot) and the
// configured charge / discharge durations. Output: the charge/discharge segments
// of every day (LOW = charge, PEAK = discharge, FLAT = no action), ready for the
// Deployment 错峰调整 import files. Deterministic: no LLM, no I/O.

import { GRANULARITY_OPTIONS, groupByDate, isSupportedGranularity, validateDaySlots, type PriceSlot } from './prices.js';
import { expandToSlots, generateDailyStrategy, type StrategySegment } from './strategy.js';

export const SKILL_ID = 'battery-charge-discharge-strategy';
export const SKILL_VERSION = '3.0.0';

export interface BatteryStrategyInput {
  prices: PriceSlot[];
  /** Charge (standby) duration per day, minutes. */
  chargeMinutes: number;
  /** Discharge duration per day, minutes. */
  dischargeMinutes: number;
  /** Price slot length in hours: 0.25, 0.5 or 1. */
  granularityHours: number;
}

export interface DailyStrategy {
  strategyDate: string;
  /** A = one discharge, B = two discharges, none = not executed (the whole day is FLAT). */
  plan: 'A' | 'B' | 'none';
  /** Number of charge windows (0, 1 or 2). */
  chargeCount: number;
  /** One segment per price slot: as many records as the day's price rows. */
  segments: StrategySegment[];
  /** The same plan with adjacent equal stages merged (for reading). */
  phases: StrategySegment[];
  /** True when the two-discharge tail handling moved the discharges and charges the last 2 hours. */
  tailShifted?: boolean;
  /** True when the last phase was a discharge and the last slot of the day was set to charging. */
  lastSlotCharge?: boolean;
}

export interface BatteryStrategyResult {
  strategies: DailyStrategy[];
  /** Dates with no charging or discharging (single price tier); their strategy is one 00:00–24:00 FLAT segment. */
  notExecuted: string[];
  /** Hours actually used per day (durations are applied in whole price slots). */
  chargeHours: number;
  dischargeHours: number;
  warnings: string[];
}

export class BatteryStrategyInputError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export function runBatteryStrategySkill(input: BatteryStrategyInput): BatteryStrategyResult {
  const { prices, chargeMinutes, dischargeMinutes, granularityHours } = input;
  if (!Array.isArray(prices) || prices.length === 0) throw new BatteryStrategyInputError('no price data', 'no_price_data');
  if (!(chargeMinutes > 0) || !(dischargeMinutes > 0)) {
    throw new BatteryStrategyInputError('charge and discharge durations must be positive', 'duration_invalid');
  }
  if (!isSupportedGranularity(granularityHours)) {
    throw new BatteryStrategyInputError(
      `price granularity must be one of ${GRANULARITY_OPTIONS.join(', ')} h`,
      'granularity_invalid'
    );
  }
  // Durations in price slots (nH = N / 60 / G, mH = M / 60 / G).
  const G = granularityHours;
  const slotsPerDay = Math.round(24 / G);
  const m = Math.round(chargeMinutes / 60 / G);
  const n = Math.round(dischargeMinutes / 60 / G);
  if (m < 1 || n < 1 || m + n > slotsPerDay) {
    throw new BatteryStrategyInputError('charge + discharge must fit in one day (at least one price slot each)', 'duration_invalid');
  }
  const chargeHours = m * G;
  const dischargeHours = n * G;
  const warnings: string[] = [];
  if (Math.abs(chargeHours * 60 - chargeMinutes) > 1e-6 || Math.abs(dischargeHours * 60 - dischargeMinutes) > 1e-6) {
    warnings.push(
      `Durations are applied in whole ${G * 60}-minute price slots: charge ${chargeHours} h, discharge ${dischargeHours} h.`
    );
  }

  const strategies: DailyStrategy[] = [];
  const notExecuted: string[] = [];
  for (const [date, slots] of groupByDate(prices)) {
    const problems = validateDaySlots(slots, granularityHours);
    if (problems.length) throw new BatteryStrategyInputError(`${date}: ${problems.join('; ')}`, 'price_slots_invalid');
    const dayPrices = [...slots].sort((x, y) => x.timeSlot.localeCompare(y.timeSlot)).map((x) => x.price);
    const result = generateDailyStrategy(dayPrices, n, m, G);
    if (result.plan === 'none') notExecuted.push(date);
    strategies.push({
      strategyDate: date,
      plan: result.plan,
      chargeCount: result.plan === 'none' ? 0 : (result.chargeCount ?? 1),
      // One record per price slot (same count as the price list); `phases` keeps the merged view.
      segments: expandToSlots(result.segments, G),
      phases: result.segments,
      ...(result.tailShifted ? { tailShifted: true } : {}),
      ...(result.lastSlotCharge ? { lastSlotCharge: true } : {}),
    });
  }
  return { strategies, notExecuted, chargeHours, dischargeHours, warnings };
}

/** Skill definition for registration on an agent platform. */
export const skillDefinition = {
  id: SKILL_ID,
  name: 'Battery Charge/Discharge Strategy',
  version: SKILL_VERSION,
  description:
    'Generates battery charge/discharge rules from tiered electricity prices: charge in the cheapest hours, ' +
    'discharge in the most expensive ones (one or two windows each per day), stepping by the price slot length.',
  tags: ['battery', 'energy-saving', 'electricity-price', 'save-strategy'],
  inputSchema: {
    type: 'object',
    required: ['prices', 'chargeMinutes', 'dischargeMinutes', 'granularityHours'],
    properties: {
      prices: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['date', 'timeSlot', 'price'],
          properties: {
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            timeSlot: { type: 'string', pattern: '^\\d{2}:\\d{2}-\\d{2}:\\d{2}$' },
            price: { type: 'number' },
          },
        },
      },
      chargeMinutes: { type: 'number', exclusiveMinimum: 0 },
      dischargeMinutes: { type: 'number', exclusiveMinimum: 0 },
      granularityHours: { type: 'number', enum: [0.25, 0.5, 1] },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      strategies: { type: 'array' },
      notExecuted: { type: 'array', items: { type: 'string' } },
      chargeHours: { type: 'number' },
      dischargeHours: { type: 'number' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * UC1 FuR004: strategy algorithm (design doc 2.7). Unit tests on the pure functions.
 */
import { describe, expect, it } from 'vitest'
import { generate, hhmm, merge, planDay, roundEven, type Stage } from '../src/strategy.js'
import { BASE } from './helpers.js'

const count = (st: Stage[], s: Stage) => st.filter((x) => x === s).length

/** Small deterministic generator so the property tests are repeatable. */
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

describe('roundEven (slot counts round half to even)', () => {
  it.each([[0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [2.4, 2], [2.6, 3], [8, 8]])('%s -> %s', (x, want) => {
    expect(roundEven(x)).toBe(want)
  })
})

describe('hhmm', () => {
  it('formats slot starts for each granularity', () => {
    expect(hhmm(0, 0.5)).toBe('00:00')
    expect(hhmm(3, 0.5)).toBe('01:30')
    expect(hhmm(5, 0.25)).toBe('01:15')
    expect(hhmm(23, 1)).toBe('23:00')
  })
})

describe('planDay: the design doc example', () => {
  const st = planDay(BASE, 480, 240, 1)
  it('discharges 4 slots and charges 8, plus the last slot (step 3.5), rest FLAT', () => {
    expect(count(st, 'PEAK')).toBe(4)
    expect(count(st, 'LOW')).toBe(9)
    expect(count(st, 'FLAT')).toBe(11)
    expect(st[23]).toBe('LOW')
  })
  it('discharges in the dearest hours', () => {
    const peakHours = st.flatMap((s, i) => (s === 'PEAK' ? [i] : []))
    expect(Math.min(...peakHours.map((i) => BASE[i]))).toBeGreaterThanOrEqual(0.9)
  })
  it('gives every slot exactly one stage', () => {
    expect(st).toHaveLength(24)
    st.forEach((s) => expect(['LOW', 'FLAT', 'PEAK']).toContain(s))
  })
})

describe('planDay: price shapes', () => {
  it('one price level gives only FLAT', () => {
    expect(new Set(planDay(Array(24).fill(0.5), 480, 240, 1))).toEqual(new Set(['FLAT']))
  })
  it('two price levels never give FLAT', () => {
    const prices = [...Array(12).fill(0.2), ...Array(12).fill(0.9)]
    const st = planDay(prices, 120, 120, 1)
    expect(st).not.toContain('FLAT')
    expect(st.slice(0, 12).every((s) => s === 'LOW')).toBe(true)
    expect(st.slice(12, 23).every((s) => s === 'PEAK')).toBe(true)
    expect(st[23]).toBe('LOW') // the day may not end on a discharge: the last slot charges
  })
  it('a peak at the very end uses the last-hour exception: the last slot is charged, not discharged', () => {
    const prices = [...Array(20).fill(0.3), 0.5, 0.6, 0.9, 1.0]
    const st = planDay(prices, 240, 120, 1)
    expect(st[23]).not.toBe('PEAK')
    expect(count(st, 'PEAK')).toBe(2)
  })
  it('rises through the day: charges early, discharges late', () => {
    const prices = Array.from({ length: 24 }, (_, i) => 0.2 + i * 0.03)
    const st = planDay(prices, 240, 240, 1)
    expect(st.indexOf('LOW')).toBeLessThan(st.indexOf('PEAK'))
  })
})

describe('planDay: granularity and durations', () => {
  it('works with 15-minute slots (96 per day)', () => {
    const prices = Array.from({ length: 96 }, (_, i) => 0.3 + 0.5 * Math.sin((i / 96) * Math.PI * 2) ** 2)
    const st = planDay(prices, 360, 180, 0.25)
    expect(st).toHaveLength(96)
    expect(count(st, 'PEAK')).toBe(12)
    expect(count(st, 'LOW')).toBe(25)
  })
  it('works with half-hour slots (48 per day)', () => {
    const prices = Array.from({ length: 48 }, (_, i) => 0.3 + (i % 12) * 0.05)
    const st = planDay(prices, 480, 240, 0.5)
    expect(st).toHaveLength(48)
    expect(count(st, 'PEAK')).toBe(8)
    expect(count(st, 'LOW')).toBe(16)
  })
  it('handles a single discharge slot (N = 1)', () => {
    const st = planDay(BASE, 240, 60, 1)
    expect(count(st, 'PEAK')).toBe(1)
    expect(count(st, 'LOW')).toBe(5)
  })
  it('handles a single charge slot (M = 1)', () => {
    const st = planDay(BASE, 60, 240, 1)
    expect(count(st, 'LOW')).toBe(2)
    expect(count(st, 'PEAK')).toBe(4)
  })
  it('treats a duration shorter than one slot as one slot', () => {
    const st = planDay(BASE, 10, 10, 1)
    expect(count(st, 'PEAK')).toBe(1)
    expect(count(st, 'LOW')).toBeGreaterThanOrEqual(1)
  })
})

describe('planDay: properties over many random days', () => {
  const rand = rng(11)
  const cases = Array.from({ length: 400 }, () => {
    const g = [0.25, 0.5, 1][Math.floor(rand() * 3)]
    const levels = 3 + Math.floor(rand() * 7)
    return {
      g,
      prices: Array.from({ length: Math.round(24 / g) }, () => Math.round(rand() * levels) / levels),
      charge: 60 * (1 + Math.floor(rand() * 8)),
      discharge: 60 * (1 + Math.floor(rand() * 5)),
    }
  })
  it('keeps the slot count, never ends on a discharge and has at most two discharge periods', () => {
    for (const c of cases) {
      const st = planDay(c.prices, c.charge, c.discharge, c.g)
      const rows = merge('d', st, c.g)
      expect(st).toHaveLength(c.prices.length)
      if (new Set(c.prices).size <= 1) {
        expect(new Set(st)).toEqual(new Set(['FLAT']))
        continue
      }
      expect(st[st.length - 1]).not.toBe('PEAK')
      // two price levels label every slot by its tier, so any number of periods is fine there
      if (new Set(c.prices).size > 2) expect(rows.filter((r) => r.stage === 'PEAK').length).toBeLessThanOrEqual(2)
    }
  })
  it('is deterministic', () => {
    for (const c of cases.slice(0, 50)) expect(planDay(c.prices, c.charge, c.discharge, c.g)).toEqual(planDay(c.prices, c.charge, c.discharge, c.g))
  })
})

describe('merge', () => {
  it('joins neighbouring slots with the same stage and ends at 24:00', () => {
    const rows = merge('2026-10-24', ['LOW', 'LOW', 'FLAT', 'PEAK', 'PEAK', 'PEAK'], 4)
    expect(rows).toEqual([
      { date: '2026-10-24', startTime: '00:00', endTime: '08:00', stage: 'LOW' },
      { date: '2026-10-24', startTime: '08:00', endTime: '12:00', stage: 'FLAT' },
      { date: '2026-10-24', startTime: '12:00', endTime: '24:00', stage: 'PEAK' },
    ])
  })
  it('gives one row for a day with a single stage', () => {
    expect(merge('d', Array(24).fill('FLAT'), 1)).toEqual([{ date: 'd', startTime: '00:00', endTime: '24:00', stage: 'FLAT' }])
  })
  it('rows cover the whole day without gaps', () => {
    const rows = merge('d', planDay(BASE, 480, 240, 1), 1)
    expect(rows[0].startTime).toBe('00:00')
    rows.slice(1).forEach((r, i) => expect(r.startTime).toBe(rows[i].endTime))
    expect(rows[rows.length - 1].endTime).toBe('24:00')
  })
})

describe('generate: several days', () => {
  it('plans each day on its own, in date order', () => {
    const rows: [string, number, number][] = [
      ...BASE.map((p, i): [string, number, number] => ['2026-10-25', i, p]),
      ...BASE.map((p, i): [string, number, number] => ['2026-10-24', i, p]),
    ]
    const out = generate(rows, 480, 240, 1)
    expect(out[0].date).toBe('2026-10-24')
    expect(new Set(out.map((r) => r.date))).toEqual(new Set(['2026-10-24', '2026-10-25']))
    const day = (d: string) => out.filter((r) => r.date === d).map(({ startTime, endTime, stage }) => ({ startTime, endTime, stage }))
    expect(day('2026-10-24')).toEqual(day('2026-10-25'))
  })
  it('accepts slots given out of order', () => {
    const shuffled: [string, number, number][] = BASE.map((p, i): [string, number, number] => ['d', i, p]).reverse()
    expect(generate(shuffled, 480, 240, 1)).toEqual(generate(BASE.map((p, i): [string, number, number] => ['d', i, p]), 480, 240, 1))
  })
  it('gives nothing for no rows', () => {
    expect(generate([], 480, 240, 1)).toEqual([])
  })
})

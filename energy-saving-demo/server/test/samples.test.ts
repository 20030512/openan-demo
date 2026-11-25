// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The strategy against the colleague's price samples (sample/test-prices, from the energy-saving-uc project).
 * expected-results.csv holds the plan the team's algorithm gives for each file with charge 300 min and discharge 240 min;
 * every row of it must come out the same here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { merge, planDay } from '../src/strategy.js'

const dir = fileURLToPath(new URL('../../sample/test-prices/', import.meta.url))

/** The csv has quoted cells with commas inside; no cell holds a quote. */
function csvRows(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => [...line.matchAll(/"([^"]*)"|([^,]*)(?:,|$)/g)].map((m) => m[1] ?? m[2]).slice(0, 8))
}

async function pricesByDay(file: string): Promise<Map<string, number[]>> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(join(dir, file))
  const days = new Map<string, { slot: string; price: number }[]>()
  wb.worksheets[0].eachRow((row, i) => {
    if (i === 1) return
    const v = row.getCell(1).value
    const date = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
    days.set(date, [...(days.get(date) ?? []), { slot: String(row.getCell(2).value), price: Number(row.getCell(3).value) }])
  })
  return new Map([...days].sort(([a], [b]) => a.localeCompare(b)).map(([d, s]) => [d, s.sort((x, y) => x.slot.localeCompare(y.slot)).map((x) => x.price)]))
}

const text = (date: string, stages: ReturnType<typeof planDay>, g: number) => {
  const rows = merge(date, stages, g)
  const shown = rows.length === 1 && rows[0].stage === 'FLAT' ? rows : rows.filter((r) => r.stage !== 'FLAT')
  return shown.map((r) => `${r.stage} ${r.startTime}–${r.endTime}`).join(', ')
}

const expected = csvRows(readFileSync(join(dir, 'expected-results.csv'), 'utf8'))

describe('strategy against the sample price files', () => {
  it('reads all the rows of expected-results.csv', () => {
    expect(expected.length).toBeGreaterThan(100)
  })
  // The importer reads .xlsx only; the .xls and .csv samples hold the same tariff as A1.
  const files = [...new Set(expected.map((r) => r[0]))].filter((f) => f.endsWith('.xlsx'))
  it.each(files)('%s', async (file) => {
    const prices = await pricesByDay(file)
    for (const [f, g, date, , , , , segments] of expected.filter((r) => r[0] === file)) {
      expect(f).toBe(file)
      expect(text(date, planDay(prices.get(date)!, 300, 240, Number(g)), Number(g)), `${file} ${date}`).toBe(segments)
    }
  })
})

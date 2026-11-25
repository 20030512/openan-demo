// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every text given to tr() in the source must have a Chinese line in src/i18n.ts, and no Chinese line may be unused.
const src = import.meta.dirname
const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== 'i18n.ts' ? [join(d, f)] : []))

const used = new Set<string>()
for (const f of files(src)) {
  const code = readFileSync(f, 'utf8')
  for (const m of code.matchAll(/\btr\(\s*'((?:\\'|[^'])*)'/g)) used.add(m[1].replace(/\\'/g, "'"))
}
// Texts that reach tr() through a variable (labels of constants, texts of the server).
const INDIRECT = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
  '15 min', '30 min', '60 min', 'By weekday', '错峰调整按天配置 · one sheet per weekday (7 sheets)',
  'Energy-Saving UC', 'Save Strategy', 'Dashboard, task dispatch, test data', 'Charge/discharge plan, Deployment export',
  'Fixed', 'Dynamic', 'Import succeeded, strategy auto-generated',
]

const entry = /^[ ]*(?:'((?:\\'|[^'\n])*)'|([A-Za-z]+)):[ ]*'/gm
const zhKeys = [...readFileSync(join(src, 'i18n.ts'), 'utf8').matchAll(entry)].map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'"))

describe('Chinese for the Save Strategy page', () => {
  it('has a Chinese line for every text', () => {
    expect([...used, ...INDIRECT].filter((k) => !zhKeys.includes(k))).toEqual([])
  })
  it('has no unused line', () => {
    expect(zhKeys.filter((k) => !used.has(k) && !INDIRECT.includes(k))).toEqual([])
  })
})

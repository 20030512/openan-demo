// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZH } from '../src/lib/zh'
import { DYNAMIC, files, keys, SRC } from './scan'

describe('Chinese sublines', () => {
  const found = new Map<string, string>()
  for (const f of files(SRC)) for (const k of keys(readFileSync(f, 'utf8'))) found.set(k, f.slice(SRC.length + 1))
  for (const k of DYNAMIC) found.set(k, 'server data')

  it('finds the texts', () => {
    expect(found.size).toBeGreaterThan(100)
  })

  it('has a Chinese line for every English text', () => {
    const missing = [...found].filter(([k]) => !ZH[k]).map(([k, f]) => `${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('has no unused entries and keeps placeholders in step', () => {
    expect(Object.keys(ZH).filter((k) => !found.has(k))).toEqual([])
    for (const [en, zh] of Object.entries(ZH)) {
      const a = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      const b = [...zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(b, en).toEqual(a)
    }
  })
})

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const SRC = join(import.meta.dirname, '..', 'src')
const SKIP = new Set(['zh.ts', 'finance-bento.tsx'])

export function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(f) && !SKIP.has(f) ? [p] : []
  })
}

const unescape = (s: string) => s.replace(/\\(.)/g, '$1')

/** Every English text the pages can show: <T>, <Tx>, <P>, <H>, <Cap>, <Box>, s=, label=, title=, confirm=, head={[...]} and t('...'). */
export function keys(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/<(T|Tx|P|H|Cap|Box)\b[^>]*>([^<{}]+)<\/\1>/g)) out.push(m[2].trim())
  for (const m of src.matchAll(/<T\b[^>]*\bs="([^"]+)"/g)) out.push(m[1])
  for (const m of src.matchAll(/(?<![-\w])(?:label|title|confirm)="([^"]+)"/g)) out.push(m[1])
  for (const m of src.matchAll(/head=\{\[([^\]]*)\]\}/g)) {
    for (const q of m[1].matchAll(/'((?:\\.|[^'\\])*)'/g)) out.push(unescape(q[1]))
  }
  for (const m of src.matchAll(/\bt\((['"`])((?:\\.|(?!\1).)*)\1\)/g)) out.push(unescape(m[2]))
  return out
}

/** Texts that reach <T> from the server or from data, so no source literal holds them. */
const BUILT_IN_TEXT: string[] = []

export const DYNAMIC = new Set([
  'Region total', 'Region daily avg.', 'Per-site daily avg.',
  'CNY', 'kWh',
  'Total', 'NR', 'LTE', 'Suggestion', 'Execution', 'Difference',
  'Total energy consumption', '5G energy consumption', '4G energy consumption',
  'Targets met. Keep the current configuration.',
  'The requested targets cannot both be met. Lower the saving target and the speed guarantee?',
  'Saved',
  ...BUILT_IN_TEXT,
])


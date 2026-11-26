// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { Db } from './db.js'

/** The database exists, but its tables are not the ones of the application (a file made by hand, or by another program). */
export class DatabaseStructureError extends Error {
  constructor(readonly problems: string[]) {
    super(`The database does not match the application: ${problems.join('; ')}`)
  }
}

const tablesOf = (db: Db) => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name)
const columnsOf = (db: Db, table: string) => (db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as { name: string }[]).map((r) => r.name)

/**
 * The tables of the application that are missing in `db`, or are there with other columns (a table of the same name made by hand).
 * `reference` is a database made by the application itself, so the list of tables and columns is never written twice. A table or a
 * column that only `db` has is fine. Each problem is one short sentence: `price_data: columns batch_id, price_date missing (the table
 * has: id, foo)`.
 */
export function structureProblems(db: Db, reference: Db): string[] {
  const have = tablesOf(db)
  const out: string[] = []
  for (const table of tablesOf(reference)) {
    if (!have.includes(table)) {
      out.push(`${table}: the table is missing`)
      continue
    }
    const columns = columnsOf(db, table)
    const missing = columnsOf(reference, table).filter((c) => !columns.includes(c))
    if (missing.length) out.push(`${table}: ${missing.length === 1 ? 'column' : 'columns'} ${missing.join(', ')} missing (the table has: ${columns.join(', ') || 'no columns'})`)
  }
  return out
}

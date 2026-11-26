// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The database file must exist: a missing file is an error (./start.sh init-db makes it), and an empty file that the user made is filled with
 * all tables and the structure when it is opened.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { DatabaseStructureError } from '../src/db-check.js'
import { openDb } from '../src/db.js'
import { SAMPLE } from './helpers.js'

const keep = process.env.DB_CREATE
afterEach(() => {
  if (keep === undefined) delete process.env.DB_CREATE
  else process.env.DB_CREATE = keep
})
const tables = (file: string) => {
  const db = openDb(file)
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
  db.close()
  return names
}

describe('the database file', () => {
  it('a missing file is an error that names the command that makes it', () => {
    delete process.env.DB_CREATE
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'none', 'energy.db')
    expect(() => openDb(file)).toThrow(/does not exist\. Make it with \.\/start\.sh init-db/)
  })
  it('an empty file the user made is filled with the tables and the structure when the server starts', async () => {
    delete process.env.DB_CREATE
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'energy.db')
    writeFileSync(file, '')
    const app = await buildApp({ dbPath: file, samplePath: SAMPLE })
    await app.close()
    const names = tables(file)
    for (const t of ['system_config', 'price_data', 'charge_discharge_strategy', 'task', 'region']) expect(names).toContain(t)
  })
  it('init-db (DB_CREATE=true) makes the folder and the file', () => {
    process.env.DB_CREATE = 'true'
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'new', 'folder', 'energy.db')
    expect(tables(file)).toContain('price_data')
  })
  it('the memory database of the tests needs nothing', () => {
    delete process.env.DB_CREATE
    expect(tables(':memory:')).toContain('price_data')
  })

  it('a database made by hand with other columns is an error that says which table and column', async () => {
    delete process.env.DB_CREATE
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'energy.db')
    const own = new DatabaseSync(file)
    own.exec('CREATE TABLE price_data(id INTEGER PRIMARY KEY, foo TEXT); CREATE TABLE task(id TEXT, state TEXT);')
    own.close()
    const err = await buildApp({ dbPath: file, samplePath: SAMPLE }).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DatabaseStructureError)
    const text = (err as DatabaseStructureError).problems.join('\n')
    expect(text).toContain('price_data: columns batch_id, price_date, time_slot, price_value missing (the table has: id, foo)')
    expect(text).toContain('task: columns')
  })
  it('a database of the application itself passes, also when it has more tables or columns than the application', async () => {
    delete process.env.DB_CREATE
    const file = join(mkdtempSync(join(tmpdir(), 'db-')), 'energy.db')
    const own = new DatabaseSync(file)
    own.exec('CREATE TABLE my_notes(id INTEGER, note TEXT);')
    own.close()
    const app = await buildApp({ dbPath: file, samplePath: SAMPLE })
    await app.close()
    expect(tables(file)).toContain('my_notes')
  })
})

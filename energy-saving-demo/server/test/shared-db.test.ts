// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * One database for the two apps. The strategy app (apps/energy-saving-uc) makes its tables with the SQL below, copied from
 * its backend/src/services/db.ts; this app must read what that app wrote and write what that app reads.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { SAMPLE } from './helpers.js'

const STRATEGY_APP_TABLES = `
CREATE TABLE IF NOT EXISTS system_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL, config_type TEXT NOT NULL DEFAULT 'VARCHAR', description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS network_element (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, generation_mode TEXT NOT NULL DEFAULT 'Fixed',
  discharge_threshold INTEGER NOT NULL DEFAULT 80, target_duration INTEGER);
CREATE TABLE IF NOT EXISTS price_data (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, price_date TEXT NOT NULL, time_slot TEXT NOT NULL, price_value REAL NOT NULL);
CREATE TABLE IF NOT EXISTS charge_discharge_strategy (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, strategy_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, stage TEXT NOT NULL);
INSERT OR IGNORE INTO system_config (config_key, config_value, config_type, description) VALUES ('standby_duration','300','INT','x'),('discharge_duration','240','INT','x'),('price_granularity','0.5','FLOAT','x');
`

const hhmm = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`

describe('the two apps share one database file', () => {
  process.env.DB_CREATE = 'true' // these tests make their own database files
  const dir = mkdtempSync(join(tmpdir(), 'shared-db-'))
  const file = join(dir, 'shared.db')
  const apps: Awaited<ReturnType<typeof buildApp>>[] = []
  afterAll(async () => {
    for (const a of apps) await a.close()
  })

  it('reads a day the strategy app wrote: prices, one row per slot, and shows the plan as periods', async () => {
    // the strategy app starts first, makes its tables and writes a batch with one strategy row per price slot
    const other = new DatabaseSync(file)
    other.exec(STRATEGY_APP_TABLES)
    const ins = other.prepare('INSERT INTO price_data(batch_id,price_date,time_slot,price_value) VALUES(?,?,?,?)')
    const st = other.prepare('INSERT INTO charge_discharge_strategy(batch_id,strategy_date,start_time,end_time,stage) VALUES(?,?,?,?,?)')
    for (let i = 0; i < 48; i++) {
      ins.run(7, '2026-10-24', `${hhmm(i)}-${hhmm(i + 1)}`, i < 10 ? 0.3 : 0.8)
      st.run(7, '2026-10-24', hhmm(i), hhmm(i + 1), i < 10 ? 'LOW' : 'FLAT')
    }
    other.close()

    const app = await buildApp({ dbPath: file, samplePath: SAMPLE })
    apps.push(app)
    const q = (await app.inject('/api/energy-saving/query?day=2026-10-24')).json()
    expect(q.batchId).toBe(7)
    expect(q.prices).toHaveLength(48)
    expect(q.plan).toEqual([{ date: '2026-10-24', startTime: '00:00', endTime: '05:00', stage: 'LOW' }]) // 10 slot rows are one period
    expect((await app.inject('/api/config')).json()).toMatchObject({ standbyDuration: 300, dischargeDuration: 240, priceGranularity: 0.5 })
    expect((await app.inject('/api/prices/latest-batch')).json()).toEqual({ batchId: 7 })
  })

  it('writes what the strategy app reads: an applied dataset is in its tables, under its column names', async () => {
    const app = apps[0]
    const list = (await app.inject('/api/test-data')).json() as { id: number; name: string }[]
    const d = list.find((x) => x.name === 'A1 tiered-tariff')!
    expect((await app.inject({ method: 'POST', url: `/api/test-data/${d.id}/apply`, payload: { baseDate: '2026-10-24' } })).statusCode).toBe(200)

    const other = new DatabaseSync(file)
    const batch = (other.prepare('SELECT MAX(batch_id) AS b FROM price_data').get() as { b: number }).b
    expect(batch).toBe(8)
    const prices = other.prepare('SELECT price_date, time_slot, price_value FROM price_data WHERE batch_id=? AND price_date=? ORDER BY time_slot').all(batch, '2026-10-24')
    expect(prices).toHaveLength(48)
    expect({ ...prices[0] }).toEqual({ price_date: '2026-10-24', time_slot: '00:00-00:30', price_value: 0.25 })
    const strategy = other.prepare('SELECT strategy_date, start_time, end_time, stage FROM charge_discharge_strategy WHERE batch_id=? AND strategy_date=? ORDER BY id').all(batch, '2026-10-24')
    expect(strategy.length).toBeGreaterThan(3)
    expect({ ...strategy[0] }).toEqual({ strategy_date: '2026-10-24', start_time: '00:00', end_time: '05:00', stage: 'LOW' })
    // the config the strategy app reads is the one this app applied, in the same rows
    const cfg = other.prepare("SELECT config_value FROM system_config WHERE config_key='standby_duration'").get() as { config_value: string }
    expect(cfg.config_value).toBe('300')
    other.close()
  })

  it('a database made by an older version is moved to the shared tables, keeping its data', async () => {
    const old = join(dir, 'old.db')
    const db = new DatabaseSync(old)
    db.exec(`
      CREATE TABLE system_config(config_key TEXT PRIMARY KEY, config_value TEXT);
      CREATE TABLE price_data(id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INT, date TEXT, slot INT, time_slot TEXT, price_value REAL);
      CREATE TABLE charge_discharge_strategy(id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INT, date TEXT, start_time TEXT, end_time TEXT, stage TEXT);
      INSERT INTO system_config VALUES('standby_duration','480'),('discharge_duration','240'),('price_granularity','0.5');
      INSERT INTO price_data(batch_id,date,slot,time_slot,price_value) VALUES(3,'2026-10-24',0,'00:00-00:30',0.3);
      INSERT INTO charge_discharge_strategy(batch_id,date,start_time,end_time,stage) VALUES(3,'2026-10-24','00:00','24:00','FLAT');`)
    db.close()
    const app = await buildApp({ dbPath: old, samplePath: SAMPLE })
    apps.push(app)
    expect((await app.inject('/api/config')).json()).toMatchObject({ standbyDuration: 480 }) // the saved value is kept
    expect((await app.inject('/api/prices?date=2026-10-24')).json()).toHaveLength(1)
    const check = new DatabaseSync(old)
    const cols = (t: string) => (check.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('price_data')).toContain('price_date')
    expect(cols('charge_discharge_strategy')).toContain('strategy_date')
    expect(cols('system_config')).toEqual(expect.arrayContaining(['config_type', 'description', 'updated_at']))
    check.close()
  })
})

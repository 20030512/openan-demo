// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export interface Config {
  standbyDuration: number
  dischargeDuration: number
  priceGranularity: number
}

/**
 * The database file must exist: a missing file is an error, not something to make quietly (./start.sh init-db makes it, with
 * DB_CREATE=true). Opening a file that exists fills the tables and the structure that are not there yet, so an empty file the user made
 * is enough.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    if (!existsSync(path) && process.env.DB_CREATE !== 'true') throw new Error(`The database file ${path} does not exist. Make it with ./start.sh init-db`)
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  if (path !== ':memory:') {
    // Two apps (this one and the strategy app) write the same file: WAL lets one write while the other reads, and a busy
    // file is waited for instead of failing at once.
    // The file holds the LLM settings and all task data. Mode 0600: only the Linux user that runs the server can read or write
    // it; other users of the machine cannot open it (a new file is usually 0644, readable by every user). No effect on Windows.
    try {
      chmodSync(path, 0o600)
    } catch {
      // a file system without permissions: nothing to do
    }
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA busy_timeout=5000')
  }
  db.exec(`
    -- The four tables below are the ones of the design (D1 2.4). The strategy app (apps/energy-saving-uc) uses the same
    -- file and the same tables, so what one app writes the other reads.
    CREATE TABLE IF NOT EXISTS system_config(
      config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL, config_type TEXT NOT NULL DEFAULT 'VARCHAR', description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS network_element(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, generation_mode TEXT,
      discharge_threshold INT, target_duration INT);
    CREATE TABLE IF NOT EXISTS price_data(
      id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, price_date TEXT NOT NULL,
      time_slot TEXT NOT NULL, price_value REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS charge_discharge_strategy(
      id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, strategy_date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, stage TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS test_dataset(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT NOT NULL DEFAULT '',
      profile TEXT NOT NULL, charge_min INT NOT NULL, discharge_min INT NOT NULL, granularity REAL NOT NULL,
      start_offset INT NOT NULL DEFAULT 0, built_in INT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      days_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback(
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL, rating INT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      admin_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback_image(
      id TEXT PRIMARY KEY, feedback_id INT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS feedback_owner ON feedback(owner_id);
    CREATE INDEX IF NOT EXISTS feedback_image_fb ON feedback_image(feedback_id);
  `)
  // Databases made before a dataset could name a region have no region column yet.
  if (!(db.prepare('PRAGMA table_info(test_dataset)').all() as { name: string }[]).some((c) => c.name === 'region')) {
    db.exec("ALTER TABLE test_dataset ADD COLUMN region TEXT NOT NULL DEFAULT ''")
  }
  migrateToSharedTables(db)
  // The defaults of the strategy app (charge 5 h, discharge 4 h, 30-minute slots); the first app to start writes them.
  const seed = db.prepare('INSERT OR IGNORE INTO system_config(config_key, config_value, config_type, description) VALUES(?,?,?,?)')
  seed.run('standby_duration', '300', 'INT', 'Charge duration (minutes)')
  seed.run('discharge_duration', '240', 'INT', 'Discharge duration (minutes)')
  seed.run('price_granularity', '0.5', 'FLOAT', 'Price granularity (hours: 0.25, 0.5 or 1)')
  return db
}

/** Run fn inside a transaction; roll back if it throws. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

const columnsOf = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

/** Databases made by older versions: the date columns got the names of the design, and system_config its other columns. */
function migrateToSharedTables(db: Db) {
  if (columnsOf(db, 'price_data').includes('date')) db.exec('ALTER TABLE price_data RENAME COLUMN date TO price_date')
  if (columnsOf(db, 'charge_discharge_strategy').includes('date')) db.exec('ALTER TABLE charge_discharge_strategy RENAME COLUMN date TO strategy_date')
  const cfg = columnsOf(db, 'system_config')
  if (!cfg.includes('config_type')) db.exec("ALTER TABLE system_config ADD COLUMN config_type TEXT NOT NULL DEFAULT 'VARCHAR'")
  if (!cfg.includes('description')) db.exec('ALTER TABLE system_config ADD COLUMN description TEXT')
  if (!cfg.includes('created_at')) db.exec("ALTER TABLE system_config ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")
  if (!cfg.includes('updated_at')) db.exec("ALTER TABLE system_config ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
}

/** Write one config value, keeping the other columns of its row. */
export function setConfig(db: Db, key: string, value: string) {
  db.prepare(
    "INSERT INTO system_config(config_key, config_value) VALUES(?,?) ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value, updated_at=datetime('now')",
  ).run(key, value)
}

export function getConfig(db: Db): Config {
  const rows = db.prepare('SELECT config_key AS k, config_value AS v FROM system_config').all() as { k: string; v: string }[]
  const r = Object.fromEntries(rows.map((x) => [x.k, x.v]))
  return {
    standbyDuration: Number(r.standby_duration),
    dischargeDuration: Number(r.discharge_duration),
    priceGranularity: Number(r.price_granularity),
  }
}

export function latestBatch(db: Db): number {
  const r = db.prepare('SELECT COALESCE(MAX(batch_id),0) AS b FROM price_data').get() as { b: number }
  return r.b
}

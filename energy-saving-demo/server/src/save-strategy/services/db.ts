// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// SQLite database (node:sqlite, built into Node): the one file the whole server uses (DB_PATH in config/app.env).
// Creates the D1 §2.4 tables when missing and seeds the D1 §2.6 / D2 §4.2 defaults.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('data', 'energy.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
if (DB_PATH !== ':memory:') {
  // The dashboard part of the server has its own connection to the same file: WAL lets one write while the other reads.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
}

/** Run fn in one transaction: all of it or nothing. */
export function transaction(fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS system_config (
  config_key    TEXT PRIMARY KEY,
  config_value  TEXT NOT NULL,
  config_type   TEXT NOT NULL DEFAULT 'VARCHAR',
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS network_element (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  generation_mode    TEXT NOT NULL DEFAULT 'Fixed',  -- Fixed | Dynamic
  discharge_threshold INTEGER NOT NULL DEFAULT 80,   -- 50..100 (%)
  target_duration    INTEGER                         -- 30..600 (minutes), Dynamic only
);

CREATE TABLE IF NOT EXISTS price_data (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    INTEGER NOT NULL,
  price_date  TEXT NOT NULL,          -- YYYY-MM-DD
  time_slot   TEXT NOT NULL,          -- HH:MM-HH:MM
  price_value REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS charge_discharge_strategy (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL,
  strategy_date TEXT NOT NULL,        -- YYYY-MM-DD
  start_time    TEXT NOT NULL,        -- HH:MM
  end_time      TEXT NOT NULL,        -- HH:MM
  stage         TEXT NOT NULL         -- LOW | FLAT | PEAK
);

-- Addition to D1 §2.4 (task B6): stores the dispatched energy-saving task.
CREATE TABLE IF NOT EXISTS energy_saving_task (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL,
  region     TEXT,
  answer     TEXT,
  prompt     TEXT,
  state      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed defaults (idempotent).
const seed = db.prepare(
  'INSERT OR IGNORE INTO system_config (config_key, config_value, config_type, description) VALUES (?, ?, ?, ?)'
);
const defaults: Array<[string, string, string, string]> = [
  // D1 §2.6
  ['standby_duration', '300', 'INT', 'Charge duration (minutes)'],
  ['discharge_duration', '240', 'INT', 'Discharge duration (minutes)'],
  ['price_granularity', '0.5', 'FLOAT', 'Price granularity (hours: 0.25, 0.5 or 1)'],
  // D2 §4.2
  ['energy_saving_status', 'executing', 'VARCHAR', 'Energy-saving task status'],
  ['energy_saving_effect_progress', '0', 'INT', 'Power-saving effect progress (0..100)'],
  ['energy_saving_region', '', 'VARCHAR', 'Region of the current energy-saving task'],
  ['reserve_backup_ratio', '50', 'INT', 'Default reserved backup power ratio (%)'],
];
for (const row of defaults) seed.run(...row);

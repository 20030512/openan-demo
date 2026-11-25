// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { db } from './db.js';
import { GRANULARITY_OPTIONS, isSupportedGranularity } from '../battery-skill.js';

export interface SystemConfig {
  standby_duration: number;
  discharge_duration: number;
  price_granularity: number;
  energy_saving_status: string;
  energy_saving_effect_progress: number;
  energy_saving_region: string;
  reserve_backup_ratio: number;
}

function getInt(key: string, fallback: number): number {
  const row = db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get(key) as
    | { config_value: string }
    | undefined;
  const v = row ? parseInt(row.config_value, 10) : NaN;
  return Number.isNaN(v) ? fallback : v;
}

function getFloat(key: string, fallback: number): number {
  const row = db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get(key) as
    | { config_value: string }
    | undefined;
  const v = row ? parseFloat(row.config_value) : NaN;
  return Number.isNaN(v) ? fallback : v;
}

function getStr(key: string, fallback: string): string {
  const row = db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get(key) as
    | { config_value: string }
    | undefined;
  return row ? row.config_value : fallback;
}

export function getSystemConfig(): SystemConfig {
  return {
    standby_duration: getInt('standby_duration', 480),
    discharge_duration: getInt('discharge_duration', 240),
    price_granularity: getFloat('price_granularity', 0.5),
    energy_saving_status: getStr('energy_saving_status', 'executing'),
    energy_saving_effect_progress: getInt('energy_saving_effect_progress', 0),
    energy_saving_region: getStr('energy_saving_region', ''),
    reserve_backup_ratio: getInt('reserve_backup_ratio', 50),
  };
}

export function saveSystemConfig(input: Partial<SystemConfig>): SystemConfig {
  if (input.standby_duration !== undefined && input.standby_duration <= 0) {
    throw new Error('standby_duration must be greater than 0');
  }
  if (input.discharge_duration !== undefined && input.discharge_duration <= 0) {
    throw new Error('discharge_duration must be greater than 0');
  }
  if (input.price_granularity !== undefined && !isSupportedGranularity(input.price_granularity)) {
    throw new Error(`price_granularity must be one of ${GRANULARITY_OPTIONS.join(', ')} hours`);
  }

  const set = db.prepare(
    'INSERT INTO system_config (config_key, config_value) VALUES (?, ?) ' +
      'ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = datetime(\'now\')'
  );
  if (input.standby_duration !== undefined) set.run('standby_duration', String(input.standby_duration));
  if (input.discharge_duration !== undefined) set.run('discharge_duration', String(input.discharge_duration));
  if (input.price_granularity !== undefined) set.run('price_granularity', String(input.price_granularity));

  return getSystemConfig();
}

export function setConfigValue(key: string, value: string): void {
  db.prepare(
    'INSERT INTO system_config (config_key, config_value) VALUES (?, ?) ' +
      'ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = datetime(\'now\')'
  ).run(key, value);
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { db } from './db.js';
import type { NetworkElement } from '../types/energy-saving.js';

export function listNetworkElements(): NetworkElement[] {
  return db
    .prepare('SELECT id, name, generation_mode AS generationMode, discharge_threshold AS dischargeThreshold, target_duration AS targetDuration FROM network_element ORDER BY id')
    .all() as unknown as NetworkElement[];
}

export function addNetworkElement(input: {
  name: string;
  generationMode?: 'Fixed' | 'Dynamic';
  dischargeThreshold?: number;
  targetDuration?: number;
}): NetworkElement {
  const name = (input.name || '').trim();
  if (!name) throw new Error('name is required');
  const mode = input.generationMode ?? 'Fixed';
  if (mode !== 'Fixed' && mode !== 'Dynamic') throw new Error('generationMode must be Fixed or Dynamic');
  const threshold = input.dischargeThreshold ?? 80;
  if (!Number.isInteger(threshold) || threshold < 50 || threshold > 100) {
    throw new Error('dischargeThreshold must be an integer between 50 and 100');
  }
  let target: number | null = null;
  if (mode === 'Dynamic') {
    // D1 §2.3: no default for the target backup duration; Dynamic mode needs it.
    target = input.targetDuration ?? null;
    if (target === null || !Number.isInteger(target) || target < 30 || target > 600) {
      throw new Error('targetDuration must be an integer between 30 and 600');
    }
  }

  const existing = db.prepare('SELECT id FROM network_element WHERE name = ?').get(name);
  if (existing) throw new Error('duplicate NE name');

  const info = db
    .prepare(
      'INSERT INTO network_element (name, generation_mode, discharge_threshold, target_duration) VALUES (?, ?, ?, ?)'
    )
    .run(name, mode, threshold, target);
  return db.prepare('SELECT id, name, generation_mode AS generationMode, discharge_threshold AS dischargeThreshold, target_duration AS targetDuration FROM network_element WHERE id = ?').get(info.lastInsertRowid) as unknown as NetworkElement;
}

export function deleteNetworkElement(id: number): void {
  const info = db.prepare('DELETE FROM network_element WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error('not found');
}

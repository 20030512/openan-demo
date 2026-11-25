// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { saveSystemConfig } from '../../src/save-strategy/services/system-config.service.js';
import {
  addNetworkElement,
  deleteNetworkElement,
  listNetworkElements,
} from '../../src/save-strategy/services/network-element.service.js';
import { generateStrategy } from '../../src/save-strategy/services/strategy.service.js';

// D1 §5 boundary cases.
describe('system config validation', () => {
  it('charge 0 fails', () => {
    expect(() => saveSystemConfig({ standby_duration: 0 })).toThrow();
  });
  it('discharge -1 fails', () => {
    expect(() => saveSystemConfig({ discharge_duration: -1 })).toThrow();
  });
  it('granularity 0.5 saves', () => {
    const cfg = saveSystemConfig({ price_granularity: 0.5 });
    expect(cfg.price_granularity).toBe(0.5);
  });
  it('granularity is one of 0.25 / 0.5 / 1', () => {
    for (const g of [0.25, 1, 0.5]) expect(saveSystemConfig({ price_granularity: g }).price_granularity).toBe(g);
    for (const g of [0.3, 0.75, 2, 0]) expect(() => saveSystemConfig({ price_granularity: g })).toThrow(/one of/);
  });
});

describe('network element validation', () => {
  it('empty name fails', () => {
    expect(() => addNetworkElement({ name: '' })).toThrow(/name is required/);
  });
  it('threshold 49 fails, 50 and 100 pass', () => {
    expect(() => addNetworkElement({ name: 'thr-49', dischargeThreshold: 49 })).toThrow();
    expect(addNetworkElement({ name: 'thr-50', dischargeThreshold: 50 }).dischargeThreshold).toBe(50);
    expect(addNetworkElement({ name: 'thr-100', dischargeThreshold: 100 }).dischargeThreshold).toBe(100);
  });
  it('target 30 and 600 pass, 99999 fails', () => {
    expect(
      addNetworkElement({ name: 'dyn-30', generationMode: 'Dynamic', targetDuration: 30 }).targetDuration
    ).toBe(30);
    expect(
      addNetworkElement({ name: 'dyn-600', generationMode: 'Dynamic', targetDuration: 600 }).targetDuration
    ).toBe(600);
    expect(() =>
      addNetworkElement({ name: 'dyn-bad', generationMode: 'Dynamic', targetDuration: 99999 })
    ).toThrow();
  });
  it('invalid mode fails', () => {
    expect(() =>
      addNetworkElement({ name: 'bad-mode', generationMode: 'Weird' as 'Fixed' })
    ).toThrow(/Fixed or Dynamic/);
  });
  it('duplicate name fails', () => {
    addNetworkElement({ name: 'dup' });
    expect(() => addNetworkElement({ name: 'dup' })).toThrow(/duplicate/);
  });
  it('delete missing id 99999 returns "not found"', () => {
    expect(() => deleteNetworkElement(99999)).toThrow(/not found/);
  });
  it('add then list shows 4 properties', () => {
    const ne = addNetworkElement({ name: 'listed', generationMode: 'Fixed', dischargeThreshold: 80 });
    const found = listNetworkElements().find((n) => n.id === ne.id);
    expect(found).toMatchObject({
      name: 'listed',
      generationMode: 'Fixed',
      dischargeThreshold: 80,
      targetDuration: null,
    });
  });
});

describe('strategy generation errors', () => {
  it('no price data → "no price data"', () => {
    expect(() => generateStrategy()).toThrow(/no price data/);
  });
});

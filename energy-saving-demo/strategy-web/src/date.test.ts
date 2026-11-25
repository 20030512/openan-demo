// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { getTodayDateString, getYesterdayDateString, toDateString } from './date';

describe('date helpers', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('yesterday is one day before today', () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(getYesterdayDateString()).toBe(toDateString(yesterday));
    expect(getTodayDateString()).toBe(toDateString(today));
  });
});

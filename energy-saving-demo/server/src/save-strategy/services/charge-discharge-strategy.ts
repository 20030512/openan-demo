// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// The strategy algorithm lives in the battery-charge-discharge-strategy skill.
export { generateDailyStrategy, stageFor, toHourlyPrices } from '../battery-skill.js';
export type { GenerateResult, Stage, StrategySegment } from '../battery-skill.js';

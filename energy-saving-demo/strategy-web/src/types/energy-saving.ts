// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// The types of the price data, the plan and the network elements are the server's (one definition, no copy); the page adds the
// shapes that only its API answers use.
export type { ChargeDischargePlanItem, NetworkElement, PriceDataItem, PriceStage } from '../../../server/src/save-strategy/types/energy-saving';
import type { PriceStage } from '../../../server/src/save-strategy/types/energy-saving';

export interface SystemConfig {
  standby_duration: number;
  discharge_duration: number;
  price_granularity: number;
  energy_saving_status: string;
  energy_saving_effect_progress: number;
  energy_saving_region: string;
  reserve_backup_ratio: number;
}

export interface StrategySegment {
  startTime: string;
  endTime: string;
  stage: PriceStage;
}

export interface ImportResult {
  success: boolean;
  count: number;
  batchId: number;
  message: string;
  strategies: Array<{ strategyDate: string; segments: StrategySegment[] }>;
}

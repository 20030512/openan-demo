// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Types of the price data, the plan and the network elements, shared with the strategy page (strategy-web).

export type PriceStage = 'LOW' | 'FLAT' | 'PEAK';

export interface PriceDataItem {
  id: number;
  batchId: number;
  priceDate: string;
  timeSlot: string;
  priceValue: number;
}

export interface ChargeDischargePlanItem {
  id: number;
  batchId: number;
  strategyDate: string;
  startTime: string;
  endTime: string;
  stage: PriceStage;
}

export interface NetworkElement {
  id: number;
  name: string;
  generationMode: 'Fixed' | 'Dynamic';
  dischargeThreshold: number;
  targetDuration: number | null;
}

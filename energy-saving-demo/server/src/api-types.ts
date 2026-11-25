// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Shapes of the task API that the server answers and the dashboard (web/) reads. They are defined once, here, and imported by
 * both sides; this file imports nothing, so the dashboard can use it without the server code.
 */

export type TaskState = 'sent' | 'working' | 'input_required' | 'completed' | 'failed' | 'timed_out'

/** What the Network Agent proposes when it asks the user (Negotiation-T): lower targets, always high risk. */
export interface Proposal {
  type: string
  savingTarget: { from: number; to: number; unit: string }
  speedGuarantee: { from: number; to: number; unit: string }
  risk: string
  summary: string
}

/** The effect of a task as the dashboard shows it. */
export interface EffectReport {
  region: string
  energySavingGain: number
  energySavingGainTarget: number
  actualEnergySavingPercent: number
  /** Energy saved in kWh (its share is actualEnergySavingPercent) */
  savedEnergyKwh: number
  /** Total electricity-saving income and its share in percent */
  totalSavingIncome: number
  totalSavingIncomePercent: number
  currentRateTarget: number
  actualRate: number
  targetAdjustmentSuggestion: string
}

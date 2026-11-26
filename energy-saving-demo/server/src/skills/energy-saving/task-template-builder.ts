// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { formatRateSegments, parseRateSegments, type RateSegment, type TaskParams } from '../../intent.js'
import type { ChargeDischargePlanJSON } from './strategy-reader.js'

/**
 * The Task-T template is populated with the parameters of step 1 and the strategy of step 2. The
 * A2A-T request carries the populated text in its metadata, under the Task-T extension key, next to templateUri (step 5).
 *
 * The template is the given Task-T text, with {{placeholders}} for what the sentence and the strategy fill in:
 *   {{region}}               the region of the task
 *   {{throughputSentence}}   the throughput target as the Task Description writes it: {00:00–06:00, 2Mbps}, and {06:00–24:00, 50Mbps}
 *   {{throughputTarget}}     the throughput target as the Task Context writes it: {00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}
 *   {{reserveBackupRatio}}   the reserved backup power ratio in percent
 *   {{energySavingStrategy}} the charge/discharge strategy of the latest batch read from the database (JSON)
 */
export const TASK_T_TEMPLATE = `## Operation Type
Create
## Task Type
RAN energy saving
## Task Description
Based on the time-segment-based guaranteed throughput target in the {{region}} region: {{throughputSentence}}, output a RAN energy-saving solution.
## Task Object
{{region}} Region
## Task Target
Maximize energy saving under the condition that the task context is met.
## Task Context
Time-segment-based guaranteed throughput target: {{throughputTarget}}
Reserve Backup Ratio: not lower than {{reserveBackupRatio}}%
EnergySaving Strategy: {{energySavingStrategy}}
## Expected Output
Requirements: If the task object is a geographical or logical region, the report of the energy saving intent is generated. The report must contain the following information:
### Basic information about the report
Region
Intent achievement
### Details about the report
Energy saving gain achievement, energy saving gain target, actual energy saving gain in percentage, and suggestions on target adjustment
Throughput rate target achievement, current rate target, actual rate, and suggestions on target adjustment`

/** Replace every {{name}} with its value. A placeholder without a value, or a value that is not used, is a defect: it throws. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const used = new Set<string>()
  const text = template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!(name in values)) throw new Error(`Task-T template: no value for {{${name}}}`)
    used.add(name)
    return values[name]
  })
  const unused = Object.keys(values).filter((k) => !used.has(k))
  if (unused.length) throw new Error(`Task-T template: no placeholder for ${unused.join(', ')}`)
  return text
}

/** The throughput target as the Task-T text writes it, {00:00~06:00,2Mbps}, {06:00~24:00,50Mbps}, from the rateMbps of the parameters. */
export function throughputText(params: TaskParams): string {
  return formatRateSegments(segmentsOf(params))
}

/** The throughput target as the Task Description writes it: {00:00–07:00, 2Mbps}, {07:00–17:30, 10Mbps}, and {23:00–24:00, 2Mbps}. */
export function throughputSentence(params: TaskParams): string {
  const parts = segmentsOf(params).map((x) => `{${x.start}–${x.end}, ${x.mbps}Mbps}`)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts[0]
}

function segmentsOf(params: TaskParams): RateSegment[] {
  const segments = parseRateSegments(params.rateMbps)
  if (!segments.length) throw new Error('rateMbps holds no valid time segments: ' + JSON.stringify(params.rateMbps))
  return segments
}

/** The Task-T template, populated with the parameters and the strategy. */
export function buildTaskT(params: TaskParams, plan: ChargeDischargePlanJSON): string {
  return fillTemplate(TASK_T_TEMPLATE, {
    region: params.region,
    throughputSentence: throughputSentence(params),
    throughputTarget: throughputText(params),
    reserveBackupRatio: String(params.reserveBackupRatio),
    energySavingStrategy: JSON.stringify(plan),
  })
}

export interface TaskRequest {
  /** The populated Task-T template: everything the Network Agent needs (parameters and strategy) is in this text. */
  text: string
}

/** Combine the extracted parameters with the charge/discharge strategy in the populated template. */
export function buildTaskRequest(params: TaskParams, plan: ChargeDischargePlanJSON): TaskRequest {
  return { text: buildTaskT(params, plan) }
}

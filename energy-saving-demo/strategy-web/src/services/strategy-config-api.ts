// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { API } from './base';
// Front-end API wrapper for the strategy configuration page (D1).

import type {
  ChargeDischargePlanItem,
  ImportResult,
  NetworkElement,
  PriceDataItem,
  SystemConfig,
} from '../types/energy-saving';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** 'tou' = Time-of-Use by month; 'day' / 'month' = Chinese Deployment templates. */
export type ExportTemplate = 'tou' | 'day' | 'month';

const strategyConfigApi = {
  async getConfig(): Promise<SystemConfig> {
    return json<SystemConfig>(await fetch(`${API}/config`));
  },

  async saveConfig(config: Partial<SystemConfig>): Promise<SystemConfig> {
    const res = await fetch(`${API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return json<SystemConfig>(res);
  },

  async listNetworkElements(): Promise<NetworkElement[]> {
    return json<NetworkElement[]>(await fetch(`${API}/network-elements`));
  },

  async addNetworkElement(input: {
    name: string;
    generationMode: 'Fixed' | 'Dynamic';
    dischargeThreshold?: number;
    targetDuration?: number;
  }): Promise<NetworkElement> {
    const res = await fetch(`${API}/network-elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<NetworkElement>(res);
  },

  async deleteNetworkElement(id: number): Promise<void> {
    const res = await fetch(`${API}/network-elements/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || `Request failed (${res.status})`);
    }
  },

  async importPrices(file: File): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}/price/import`, { method: 'POST', body: form });
    return json<ImportResult>(res);
  },

  async listPrices(): Promise<PriceDataItem[]> {
    return json<PriceDataItem[]>(await fetch(`${API}/price/latest`));
  },

  async listStrategies(): Promise<ChargeDischargePlanItem[]> {
    return json<ChargeDischargePlanItem[]>(await fetch(`${API}/strategy/latest`));
  },

  /** D1 generateStrategy: regenerate from the latest price batch with the current durations. */
  async generateStrategy(): Promise<{ batchId: number; notExecuted: string[]; warnings: string[] }> {
    return json(await fetch(`${API}/strategy/generate`, { method: 'POST' }));
  },

  async exportDeployment(
    template: ExportTemplate,
    applyDateToEmpty?: string
  ): Promise<{ filename: string; blob: Blob; summary: { filled: string[]; empty: string[] } }> {
    const res = await fetch(`${API}/strategy/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, applyDateToEmpty }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || `Request failed (${res.status})`);
    }
    const summaryRaw = res.headers.get('X-Export-Summary');
    let summary: { filled: string[]; empty: string[] } = { filled: [], empty: [] };
    if (summaryRaw) {
      try {
        summary = JSON.parse(decodeURIComponent(summaryRaw));
      } catch {
        summary = { filled: [], empty: [] };
      }
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    // Prefer the UTF-8 name (the template's Chinese file name), else the ASCII fallback.
    const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const ascii = cd.match(/filename="([^"]+)"/);
    const filename = utf8 ? decodeURIComponent(utf8[1]) : ascii ? ascii[1] : `strategy-${template}.xlsx`;
    return { filename, blob, summary };
  },

  exportCsvUrl(): string {
    return `${API}/strategy/export.csv`;
  },
};

export default strategyConfigApi;

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// Express app: save-strategy routes (A3–A8). The server mounts it at /strategy (see ../index.ts):
// its API is /strategy/api/..., its page /strategy/.

import express from 'express';
import multer from 'multer';
import { assertSafeValue, HighRiskInputError } from '../guard/high-risk.js';

import { getSystemConfig, saveSystemConfig } from './services/system-config.service.js';
import {
  listNetworkElements,
  addNetworkElement,
  deleteNetworkElement,
} from './services/network-element.service.js';
import {
  importPriceData,
  getLatestBatchId,
  getLatestPrices,
} from './services/price-data.service.js';
import { generateStrategy, getLatestStrategy } from './services/strategy.service.js';
import { exportDeployment, exportCsv, exportTimeOfUseByMonth } from './services/deployment-export.service.js';
import { buildSamplePriceWorkbook } from './services/sample-price.service.js';

export const app = express();
app.use(express.json());
// Every query and JSON body is checked for the customer's high-risk commands and for injection (../guard/high-risk.ts);
// uploaded price files are checked cell by cell where they are read.
app.use((req, res, next) => {
  try {
    assertSafeValue(req.query, 'the query');
    if (req.body !== undefined) assertSafeValue(req.body, 'the request');
    next();
  } catch (e) {
    if (!(e instanceof HighRiskInputError)) return next(e);
    console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), url: '/strategy' + req.url, msg: e.message }));
    res.status(400).json({ message: e.message });
  }
});

const upload = multer({ storage: multer.memoryStorage() });

// ─── A3: system config ───
app.get('/api/config', (_req, res) => res.json(getSystemConfig()));
app.post('/api/config', (req, res) => {
  try {
    res.json(saveSystemConfig(req.body));
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
});

// ─── A4: network elements ───
app.get('/api/network-elements', (_req, res) => res.json(listNetworkElements()));
app.post('/api/network-elements', (req, res) => {
  try {
    res.status(201).json(addNetworkElement(req.body));
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
});
app.delete('/api/network-elements/:id', (req, res) => {
  try {
    deleteNetworkElement(Number(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(404).json({ message: (e as Error).message });
  }
});

// ─── A5: price data ───
// Sample price file in the import format (dates from yesterday, sample prices).
app.get('/api/price/sample.xlsx', async (_req, res) => {
  const buffer = await buildSamplePriceWorkbook(new Date(), getSystemConfig().price_granularity);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="price_sample.xlsx"');
  res.send(buffer);
});

app.post('/api/price/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('empty file');
    const result = await importPriceData(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (e) {
    if (e instanceof HighRiskInputError) console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), url: '/strategy/api/price/import', msg: e.message }));
    res.status(400).json({ message: (e as Error).message });
  }
});
app.get('/api/price/latest', (_req, res) => res.json(getLatestPrices()));
app.get('/api/price/latest-batch', (_req, res) => res.json({ batchId: getLatestBatchId() }));

// ─── A7: strategy ───
app.post('/api/strategy/generate', (_req, res) => {
  try {
    res.json(generateStrategy());
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
});
app.get('/api/strategy/latest', (_req, res) => res.json(getLatestStrategy()));

// ─── A8: export ───
app.post('/api/strategy/export', async (req, res) => {
  try {
    const { template, applyDateToEmpty } = req.body as { template: 'tou' | 'day' | 'month'; applyDateToEmpty?: string };
    // 'day' = the weekly Deployment template (default); 'month' and 'tou'
    // (by month) stay available through the API only.
    const kind = template === 'tou' || template === 'month' ? template : 'day';
    const file = kind === 'tou' ? await exportTimeOfUseByMonth() : await exportDeployment(kind, applyDateToEmpty);
    // The template names are Chinese: plain ASCII fallback + RFC 5987 UTF-8 name.
    const asciiName = /^[ -~]+$/.test(file.filename)
      ? file.filename
      : `deployment-${kind}-${file.filename.replace(/^.*-batch/, 'batch')}`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Summary, Content-Disposition');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('X-Export-Summary', encodeURIComponent(JSON.stringify(file.summary)));
    res.send(file.buffer);
  } catch (e) {
    res.status(400).json({ message: (e as Error).message });
  }
});
app.get('/api/strategy/export.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="strategy.csv"');
  res.send(exportCsv());
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

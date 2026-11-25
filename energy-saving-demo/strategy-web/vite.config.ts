// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The save-strategy page, served by the server at /strategy/ (its API at /strategy/api/...). The build lands in
// server/public/strategy.
export default defineConfig({
  base: '/strategy/',
  plugins: [react()],
  build: { outDir: '../server/public/strategy', emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { '/strategy/api': 'http://127.0.0.1:8000' },
  },
});

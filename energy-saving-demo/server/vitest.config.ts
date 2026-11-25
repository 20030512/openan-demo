// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The save-strategy services open DB_PATH when imported; the tests point it at memory.
    setupFiles: ['./test/save-strategy/setup.ts'],
  },
})

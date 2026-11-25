// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0
//
// The charge/discharge algorithm lives in one place: ../../strategy-engine.ts. This file only keeps the import path
// of the strategy backend, so the algorithm exists once and cannot drift apart.
export * from '../../strategy-engine.js';

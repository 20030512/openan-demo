// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// The save-strategy services open the database when they are first imported: in the tests it lives in memory.
process.env.DB_PATH = ':memory:';

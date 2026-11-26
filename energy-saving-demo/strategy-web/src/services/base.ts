// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

// The app is served under a path (vite "base", /strategy/ in the combined deployment), so its API lives under the same path.
export const API = `${import.meta.env.BASE_URL}api`;

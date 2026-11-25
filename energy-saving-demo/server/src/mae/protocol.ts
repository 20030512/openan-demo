// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The interface of the Network Agent as the design describes it (3.2.2 steps 4 and 5, 6.11, 6.12): the addresses of the login, of the
 * A2A-T message stream and of the tasks, and the names the Task-T message carries. Shared by the clients of the server and, in the
 * tests and the test tools only, by the stand-in Network Agent.
 */
export const TASK_T_URI = 'https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1'
export const TEMPLATE_URI = 'Task-T/network-layer/ran-energy-saving/v1'
export const TOKEN_PATH = '/api/rest/securityManagement/v1/oauth/token'
export const STREAM_PATH = '/a2a/json/message:stream'
export const TASKS_PATH = '/a2a/tasks/'

/** A `fetch` of the Network Agent: the real one, or a stand-in in the tests. */
export type MaeFetch = (url: string, init?: RequestInit) => Promise<Response>

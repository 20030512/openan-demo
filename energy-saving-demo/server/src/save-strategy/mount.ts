// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { app } from './app.js'

/**
 * The save-strategy app at /strategy: its API at /strategy/api/..., its page (strategy-web, built into publicDir) at
 * /strategy/. The prefix is cut before Express sees the request, so the app keeps its own /api/... routes.
 */
export function mountStrategy(publicDir: string) {
  const site = express()
  site.use(app)
  if (existsSync(join(publicDir, 'index.html'))) {
    site.use(express.static(publicDir, { index: 'index.html' }))
    // The file is fixed (index.html of the built page); the request path is not used to build it.
    // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile
    site.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(publicDir, 'index.html')))
  }
  return (req: IncomingMessage, res: ServerResponse) => {
    req.url = req.url === '/strategy' ? '/' : req.url!.slice('/strategy'.length)
    site(req as express.Request, res as express.Response)
  }
}

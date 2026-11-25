// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

/** A step of the skill failed. `status` is the HTTP status the REST interface answers with; the message is the design's text. */
export class SkillError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The Network Agent refused the access token (401 or 403): the token expired or was revoked, so one new login and one more try follow. */
export class TokenRefusedError extends SkillError {}

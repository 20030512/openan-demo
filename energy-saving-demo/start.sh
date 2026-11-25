#!/usr/bin/env bash
# Copyright (c) 2026 Huawei Technologies Co., Ltd.
# All Rights Reserved.
#
# SPDX-License-Identifier: Apache-2.0

# The one script. ./start.sh [NAME=value ...] saves the settings, checks them, makes the database and starts; see README:
#   ./start.sh help   (the commands: stop, status, settings, check-llm, check-mae, backup, query, update, help)
# One command: node runs bin/ctl.mjs, which does all the work. No command of the high-risk list is used.
exec node --disable-warning=ExperimentalWarning "$(dirname "$0")/bin/ctl.mjs" "$@"

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'

/** Run an async loader on mount; expose data, error and a reload function. */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(() => {
    setError(null)
    loader().then(setData, (e: Error) => setError(e.message))
  }, [loader])
  useEffect(run, [run])
  return { data, error, reload: run }
}

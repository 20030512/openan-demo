// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { T } from '@/lib/i18n'

/** Two-step button: the first click asks, the second click does it. The ask times out after 4 seconds. */
export function ConfirmButton({ label, confirm, onConfirm, icon }: { label: string; confirm: string; onConfirm: () => void; icon: ReactNode }) {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const timer = setTimeout(() => setAsking(false), 4000)
    return () => clearTimeout(timer)
  }, [asking])
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={() => {
        if (asking) onConfirm()
        setAsking(!asking)
      }}
    >
      {icon} <T>{asking ? confirm : label}</T>
    </Button>
  )
}

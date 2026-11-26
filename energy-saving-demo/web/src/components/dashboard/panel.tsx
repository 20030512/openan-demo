// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { T } from '@/lib/i18n'

/** Tech-blue panel from the dashboard design: a glowing frame with a banner title. */
export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#2f7bff]/40 bg-[#061736]/80 shadow-[0_0_18px_rgba(30,110,255,.18)]',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2f7bff]/30 bg-gradient-to-r from-[#1a5fd6]/70 via-[#1a5fd6]/25 to-transparent py-1 pl-3 pr-3">
        <h2 className="border-l-[3px] border-cyan-300 pl-2.5 text-lg font-bold tracking-wide text-cyan-50">
          <T>{title}</T>
        </h2>
        {aside}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-2">{children}</div>
    </section>
  )
}

/** Small heading with a blue bar, used inside panels. */
export function Sub({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2">
      <h3 className="border-l-2 border-cyan-300 pl-2 text-sm font-semibold text-cyan-50"><T>{title}</T></h3>
      {aside}
    </div>
  )
}

export function Cap({ children }: { children: string }) {
  return (
    <div className="text-[11px] text-cyan-100/70">
      <T>{children}</T>
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
      <T>{message}</T>
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 underline">
          <T>Retry</T>
        </button>
      )}
    </div>
  )
}

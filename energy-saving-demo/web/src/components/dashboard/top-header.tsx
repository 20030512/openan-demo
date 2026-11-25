// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { T, useLang } from '@/lib/i18n'

export type Route = 'dashboard' | 'data' | 'design'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** UC2 2.1 and 7.3 Title bar: title in the centre, date, time and weekday at the right. */
export function TopHeader() {
  const [now, setNow] = useState(() => new Date())
  const { lang } = useLang()
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const weekday = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long' }).format(now)
  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-1 pb-9 pt-3">
            <h1 className="col-start-2 rounded-xl border border-cyan-300/60 bg-gradient-to-r from-[#0b3a8f]/70 via-[#1a5fd6]/60 to-[#0b3a8f]/70 px-6 py-1 text-center text-xl font-extrabold tracking-[0.12em] text-cyan-50 shadow-[0_0_22px_rgba(60,150,255,.55),inset_0_0_14px_rgba(120,190,255,.25)] drop-shadow-[0_0_10px_rgba(120,200,255,.8)] sm:px-10 sm:text-3xl">
        <T>Energy-Saving UC</T>
      </h1>
      <time dateTime={now.toISOString()} className="col-start-3 justify-self-end whitespace-nowrap font-mono text-[11px] tabular-nums text-cyan-100/80 sm:text-sm">
        {stamp(now)} <span className="hidden sm:inline">{weekday}</span>
      </time>
    </header>
  )
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { Coins, Leaf, type LucideIcon } from 'lucide-react'
import type { EnergyEffect } from '@/lib/api'
import { T } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/*
 * The energy-saving effect report of a finished task. It borrows the look of the Finance Bento component
 * (components/ui/finance-bento.tsx): a gradient card per measure, a big light number that counts up, and a gauge
 * made of tick marks that fill one after another. That component is a finance dashboard drawn into the DOM from
 * finance data, so it is the style that is reused here, not its labels or data.
 */

const TICKS = 40
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/** Counts from 0 to the value once; with reduced motion it shows the value at once. */
function useCountUp(to: number, ms = 900) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(to)
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms)
      setV(to * ease(t))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return v
}

/** The ticks up to the reached share are lit. */
function TickGauge({ value, max, label }: { value: number; max: number; label: string }) {
  const lit = Math.min(TICKS - 1, Math.round((value / max) * (TICKS - 1)))
  return (
    <svg viewBox={`0 0 ${TICKS * 8} 34`} className="mt-3 h-8 w-full" role="img" aria-label={label}>
      {Array.from({ length: TICKS }, (_, i) => (
        <line
          key={i}
          x1={i * 8 + 4}
          x2={i * 8 + 4}
          y1={i % 8 === 0 ? 2 : 10}
          y2={32}
          strokeWidth={2.2}
          strokeLinecap="round"
          stroke={i <= lit ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.3)'}
          className="effect-tick"
          style={{ animationDelay: `${150 + i * 14}ms` }}
        />
      ))}
    </svg>
  )
}

/** One part of the effect: a value with its unit and, in brackets, its share in percent. */
function Measure({
  icon: Icon,
  title,
  value,
  prefix = '',
  unit,
  percent,
  gradient,
}: {
  icon: LucideIcon
  title: string
  value: number
  /** A sign before the number, such as ¥ */
  prefix?: string
  /** The unit after the number; it is translated */
  unit: string
  percent: number
  gradient: string
}) {
  const shown = useCountUp(value)
  const shownPercent = useCountUp(percent)
  return (
    <section className={cn('relative overflow-hidden rounded-3xl p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.22),inset_0_0_0_1px_rgba(255,255,255,.07)]', gradient)}>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/80">
        <Icon className="size-4" aria-hidden="true" />
        <T>{title}</T>
      </h3>
      <div className="mt-3 flex items-baseline gap-1 font-light leading-none tracking-tight tabular-nums">
        {prefix && <span className="text-3xl text-white/85">{prefix}</span>}
        <span className="text-5xl">{shown.toFixed(0)}</span>
        {unit && <span className="ml-1 text-xl text-white/75"><T>{unit}</T></span>}
        <span className="ml-2 text-2xl text-white/85">({shownPercent.toFixed(1)}%)</span>
      </div>
      <TickGauge value={percent} max={Math.max(percent * 1.25, 1)} label={`${prefix}${value} ${unit} (${percent}%)`} />
    </section>
  )
}

export function EffectReport({ data }: { data: EnergyEffect }) {
  return (
    <div className="space-y-3">
      <style>{'@keyframes effect-tick{from{opacity:0;transform:scaleY(.3)}to{opacity:1;transform:none}}.effect-tick{opacity:0;transform-box:fill-box;transform-origin:bottom;animation:effect-tick .35s cubic-bezier(.32,.72,0,1) forwards}@media (prefers-reduced-motion:reduce){.effect-tick{animation:none;opacity:1}}'}</style>
      <div className="grid gap-3 sm:grid-cols-2">
        <Measure
          icon={Leaf}
          title="Energy saved"
          value={data.savedEnergyKwh}
          unit="kWh"
          percent={data.actualEnergySavingPercent}
          gradient="bg-[linear-gradient(180deg,#9b8cff_0%,#2e43ff_38%,#2e43ff_74%,#6d7dff_100%)]"
        />
        <Measure
          icon={Coins}
          title="Total electricity-saving income"
          value={data.totalSavingIncome}
          unit="CNY"
          percent={data.totalSavingIncomePercent}
          gradient="bg-[linear-gradient(180deg,#f6bf96_0%,#c2683a_38%,#c2683a_74%,#dc8a5c_100%)]"
        />
      </div>
    </div>
  )
}

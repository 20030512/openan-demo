// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Series, Stage } from '@/lib/api'
import { T } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Series colours of the big screen: sky blue, teal green, amber, violet. */
export const PALETTE = ['#3aa8ff', '#3ee6b0', '#ffb547', '#9d8bff']

const PAD = { l: 38, r: 10, t: 8, b: 20 }

/** Smooth path through the points (same spline feel as the bento charts). */
function smooth(p: [number, number][]): string {
  if (p.length < 2) return ''
  let d = `M${p[0][0]},${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] ?? p2
    const k = 0.17
    d += `C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`
  }
  return d
}

/** Measure the box a chart has been given, so it is drawn at its real size and never stretched. */
function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

function useHover(n: number) {
  const [i, setI] = useState<number | null>(null)
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left) / Math.max(1, r.width)
    setI(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))))
  }
  return { i, onMove, onLeave: () => setI(null) }
}

function Tooltip({ x, w, title, rows }: { x: number; w: number; title: string; rows: { name: string; value: string; color: string }[] }) {
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl border border-white/12 bg-[#0a1020]/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
      style={{ left: x, transform: `translateX(${x > w * 0.6 ? 'calc(-100% - 8px)' : '8px'})` }}
    >
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-3 leading-5">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <i className="size-1.5 rounded-full" style={{ background: r.color }} />
            {r.name}
          </span>
          <b className="font-mono font-medium">{r.value}</b>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {items.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <i className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
          <T>{s.name}</T>
        </span>
      ))}
    </div>
  )
}

interface LineChartProps {
  xAxis: string[]
  series: Series[]
  yMax: number
  yTicks: number[]
  desc: string
  /** Show every n-th x label to avoid overlap. */
  every?: number
  /** Size of the box the chart fills, as classes. */
  className?: string
}

export function LineChart({ xAxis, series, yMax, yTicks, desc, every = 1, className = 'h-40' }: LineChartProps) {
  const [ref, { w, h }] = useSize()
  const n = xAxis.length
  const { i, onMove, onLeave } = useHover(n)
  const gid = useId()
  const X = (k: number) => PAD.l + (k / Math.max(1, n - 1)) * (w - PAD.l - PAD.r)
  const Y = (v: number) => PAD.t + (1 - v / yMax) * (h - PAD.t - PAD.b)
  return (
    <div ref={ref} className={cn('relative min-h-0 w-full', className)}>
      {w > 0 && h > 0 && (
        <>
          <svg width={w} height={h} className="absolute inset-0 block" role="img" aria-label={desc}>
            <defs>
              {series.map((s, k) => (
                <linearGradient key={s.name} id={`${gid}-${k}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={PALETTE[k % PALETTE.length]} stopOpacity={k === 0 ? 0.22 : 0} />
                  <stop offset="1" stopColor={PALETTE[k % PALETTE.length]} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={w - PAD.r} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,.12)" />
                <text x={PAD.l - 6} y={Y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="rgba(255,255,255,.45)" fontFamily="Geist Mono">{t}</text>
              </g>
            ))}
            {xAxis.map((x, k) =>
              k % every === 0 ? (
                <text key={x} x={X(k)} y={h - 5} textAnchor={k === xAxis.length - 1 ? 'end' : 'middle'} fontSize="9.5" fill="rgba(255,255,255,.45)" fontFamily="Geist Mono">{x}</text>
              ) : null,
            )}
            {series.map((s, k) => {
              const pts = s.data.map((v, j) => [X(j), Y(v)] as [number, number])
              const path = smooth(pts)
              return (
                <g key={s.name}>
                  {k === 0 && <path d={`${path}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z`} fill={`url(#${gid}-${k})`} />}
                  <path d={path} fill="none" stroke={PALETTE[k % PALETTE.length]} strokeWidth={k === 0 ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )
            })}
            {i !== null && (
              <g>
                <line x1={X(i)} x2={X(i)} y1={PAD.t} y2={h - PAD.b} stroke="rgba(255,255,255,.4)" />
                {series.map((s, k) => (
                  <circle key={s.name} cx={X(i)} cy={Y(s.data[i])} r="3.5" fill={PALETTE[k % PALETTE.length]} stroke="#0a1020" strokeWidth="1.5" />
                ))}
              </g>
            )}
            <rect x={PAD.l} y={0} width={Math.max(0, w - PAD.l - PAD.r)} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={onLeave} />
          </svg>
          {i !== null && (
            <Tooltip x={X(i)} w={w} title={xAxis[i]} rows={series.map((s, k) => ({ name: s.name, value: String(s.data[i]), color: PALETTE[k % PALETTE.length] }))} />
          )}
        </>
      )}
    </div>
  )
}

interface DualProps {
  xAxis: string[]
  price: number[]
  discharge: number[]
  desc: string
  /** Axis titles, already translated. */
  leftTitle?: string
  rightTitle?: string
  className?: string
}

/** Price (left axis, blue) against average Li-ion discharge (right axis, orange). */
export function DualAxisChart({ xAxis, price, discharge, desc, leftTitle, rightTitle, className = 'h-40' }: DualProps) {
  const [ref, { w, h }] = useSize()
  const n = xAxis.length
  const right = 44
  const left = 48
  const { i, onMove, onLeave } = useHover(n)
  const pMax = 1
  const dMax = 40
  const X = (k: number) => left + (k / Math.max(1, n - 1)) * (w - left - right)
  const YP = (v: number) => PAD.t + (1 - v / pMax) * (h - PAD.t - PAD.b)
  const YD = (v: number) => PAD.t + (1 - v / dMax) * (h - PAD.t - PAD.b)
  const blue = PALETTE[0]
  const orange = PALETTE[2]
  return (
    <div ref={ref} className={cn('relative min-h-0 w-full', className)}>
      {w > 0 && h > 0 && (
        <>
          <svg width={w} height={h} className="absolute inset-0 block" role="img" aria-label={desc}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={left} x2={w - right} y1={YP(t)} y2={YP(t)} stroke="rgba(255,255,255,.12)" />
                <text x={left - 6} y={YP(t) + 3.5} textAnchor="end" fontSize="9.5" fill={blue} fontFamily="Geist Mono">{t.toFixed(2)}</text>
                <text x={w - right + 6} y={YP(t) + 3.5} textAnchor="start" fontSize="9.5" fill={orange} fontFamily="Geist Mono">{Math.round(t * dMax)}</text>
              </g>
            ))}
            {leftTitle && <text transform={`translate(10 ${h / 2}) rotate(-90)`} textAnchor="middle" fontSize="9.5" fill={blue}>{leftTitle}</text>}
            {rightTitle && <text transform={`translate(${w - 8} ${h / 2}) rotate(90)`} textAnchor="middle" fontSize="9.5" fill={orange}>{rightTitle}</text>}
            {xAxis.map((x, k) =>
              k % 2 === 0 ? (
                <text key={x} x={X(k)} y={h - 5} textAnchor={k === xAxis.length - 1 ? 'end' : 'middle'} fontSize="9.5" fill="rgba(255,255,255,.45)" fontFamily="Geist Mono">{x}</text>
              ) : null,
            )}
            <path d={smooth(discharge.map((v, k) => [X(k), YD(v)]))} fill="none" stroke={orange} strokeWidth="2" strokeLinecap="round" />
            <path d={smooth(price.map((v, k) => [X(k), YP(v)]))} fill="none" stroke={blue} strokeWidth="2.2" strokeLinecap="round" />
            {i !== null && (
              <g>
                <line x1={X(i)} x2={X(i)} y1={PAD.t} y2={h - PAD.b} stroke="rgba(255,255,255,.4)" />
                <circle cx={X(i)} cy={YP(price[i])} r="3.5" fill={blue} stroke="#0a1020" strokeWidth="1.5" />
                <circle cx={X(i)} cy={YD(discharge[i])} r="3.5" fill={orange} stroke="#0a1020" strokeWidth="1.5" />
              </g>
            )}
            <rect x={left} y={0} width={Math.max(0, w - left - right)} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={onLeave} />
          </svg>
          {i !== null && (
            <Tooltip
              x={X(i)}
              w={w}
              title={xAxis[i]}
              rows={[
                { name: 'Price (CNY)', value: price[i].toFixed(2), color: blue },
                { name: 'Discharge (kWh)', value: String(discharge[i]), color: orange },
              ]}
            />
          )}
        </>
      )}
    </div>
  )
}

/** Ring colours of the big screen: blue, cyan, green, yellow. */
export const DONUT = ['#2f7bff', '#22d3ee', '#3ee6b0', '#ffd23f']

/** Ring chart: one coloured arc per mode, with the total in the middle (design 2.2c). */
export function Donut({ modes, desc, className, children }: { modes: { name: string; percent: number }[]; desc: string; className?: string; children?: ReactNode }) {
  const R = 44
  const C = 2 * Math.PI * R
  const total = modes.reduce((n, m) => n + m.percent, 0) || 1
  let used = 0
  return (
    <div className={cn('relative shrink-0', className)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={desc}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="8" />
        {modes.map((m, k) => {
          const len = (m.percent / total) * C
          const el = (
            <circle key={m.name} cx="50" cy="50" r={R} fill="none" stroke={DONUT[k % DONUT.length]} strokeWidth="8" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-used} />
          )
          used += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">{children}</div>
    </div>
  )
}

export const STAGE_COLOR: Record<Stage, string> = { LOW: '#5fb2e6', FLAT: '#8fa0a8', PEAK: '#ffb37a' }

/** One bar per price slot, coloured by the stage the algorithm chose. */
export function PriceBars({ prices, stages, desc }: { prices: number[]; stages: Stage[]; desc: string }) {
  const max = Math.max(...prices, 0.01)
  const w = 400 / prices.length
  return (
    <svg viewBox="0 0 400 90" className="block h-auto w-full" role="img" aria-label={desc} preserveAspectRatio="none">
      {prices.map((p, i) => {
        const h = Math.max(2, (p / max) * 80)
        return <rect key={i} x={i * w + w * 0.1} y={86 - h} width={w * 0.8} height={h} rx={Math.min(2, w / 3)} fill={STAGE_COLOR[stages[i]]} />
      })}
      <line x1="0" x2="400" y1="87" y2="87" stroke="rgba(255,255,255,.2)" />
    </svg>
  )
}

// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { ArrowRight, Bot, ReceiptText } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { T, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The two right-hand frames: the published energy-saving practice, drawn after its picture (the three-tier
 * architecture, its tiers OSS, Energy-Saving Agent and Externals named at the left and described at the right, and the five stages of intent-driven energy saving).
 * The texts are fixed; English here, Chinese in zh.ts.
 * Every part is placed in percent of its frame, so the drawing keeps its proportions on every screen.
 */

/** Left, top, width and (optionally) height in percent of the drawing. */
const at = (l: number, t: number, w: number, h?: number): CSSProperties => ({ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: h === undefined ? undefined : `${h}%` })

const LINE = '#7fd4ff'
const node = 'absolute flex items-center justify-center rounded-md border border-[#4f9dff]/60 bg-[#0e2f6e]/75 px-1 text-center text-[10px] leading-tight text-cyan-50'
const green = 'absolute flex items-center justify-center rounded-md border border-emerald-300/80 bg-emerald-400/15 px-1 text-center text-[10px] font-medium leading-tight text-emerald-50 shadow-[0_0_8px_rgba(60,220,160,.35)]'

/** The frame of the picture: a centred title with a line under it. */
function Frame({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className={cn('relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#2f7bff]/40 bg-[#061736]/80 shadow-[0_0_18px_rgba(30,110,255,.18)]', className)}
    >
      <h2 className="mx-3 shrink-0 border-b border-[#4f9dff]/50 px-4 pb-1 pt-1.5 text-center text-[14px] font-medium leading-snug text-cyan-50">
        <T>{title}</T>
      </h2>
      <div className="relative min-h-0 flex-1 p-2">{children}</div>
    </section>
  )
}

/** An arrow head at a point of the drawing. */
function Head({ x, y, dir }: { x: number; y: number; dir: 'up' | 'down' | 'left' }) {
  const side = dir === 'up' ? 'borderBottom' : dir === 'down' ? 'borderTop' : 'borderRight'
  const flat = dir === 'left' ? { borderTop: '3.5px solid transparent', borderBottom: '3.5px solid transparent' } : { borderLeft: '3.5px solid transparent', borderRight: '3.5px solid transparent' }
  return <i aria-hidden="true" className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%`, width: 0, height: 0, ...flat, [side]: `6px solid ${LINE}` }} />
}

/** A robot with its name under it. */
function Agent({ style, children }: { style: CSSProperties; children: ReactNode }) {
  return (
    <div className="absolute flex flex-col items-center gap-0.5 text-center text-[10px] leading-tight text-cyan-50" style={style}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#7fd4ff]/70 bg-[#1a5fd6]/60 shadow-[0_0_8px_rgba(80,170,255,.5)]">
        <Bot className="size-4 text-cyan-50" aria-hidden="true" />
      </span>
      {children}
    </div>
  )
}

/** The name of a tier, in the column at the left of the drawing. */
function TierName({ style, children }: { style: CSSProperties; children: string }) {
  return (
    <p className="absolute flex items-center text-[12px] font-semibold leading-tight text-amber-300" style={style}>
      <T>{children}</T>
    </p>
  )
}

/** What a tier does, in the column at the right of the drawing. */
function TierNote({ style, children }: { style: CSSProperties; children: string }) {
  return (
    <p className="absolute flex items-center text-[10.5px] leading-snug text-cyan-50/90" style={style}>
      <T>{children}</T>
    </p>
  )
}

/** Right, upper: ecosystem innovation under a three-tier architecture. */
export function ArchitecturePanel({ className }: { className?: string }) {
  return (
    <Frame title="Ecosystem Innovation Under a Three-Tier Architecture" className={className}>
      <div className="relative h-full w-full">
        {/* The borders between the tiers, across the whole frame. */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 33 H100 M0 68 H100" fill="none" stroke={LINE} strokeWidth="1" strokeDasharray="3 3" strokeOpacity=".45" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* The name of each tier at the left, what it does at the right */}
        <TierName style={at(0, 0, 10, 33)}>{t('OSS')}</TierName>
        <TierName style={at(0, 33, 10, 35)}>{t('Energy-Saving Agent')}</TierName>
        <TierName style={at(0, 68, 10, 32)}>{t('Externals')}</TierName>
        <TierNote style={at(71, 0, 29, 33)}>{t('Cloud-native large model / retrieval service, agent registry and orchestration')}</TierNote>
        <TierNote style={at(71, 33, 29, 35)}>{t("Turns the operator's goal and the prices of the day into an energy-saving task with a charge and discharge plan")}</TierNote>
        <TierNote style={at(71, 68, 29, 32)}>{t('Vendor network agents run the task over A2A-T; the tariff platform gives the prices')}</TierNote>

        {/* The drawing, between the two columns (its own coordinates run 0 to 64). */}
        <div className="absolute inset-y-0 left-[10%] right-[3%]">
        {/* Lines of the drawing; the arrow heads are separate so they keep their shape. */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g fill="none" stroke={LINE} strokeWidth="1" vectorEffect="non-scaling-stroke">
            {/* group system down to the agent, and the second system up to the group */}
            <path d="M33 30 V50" vectorEffect="non-scaling-stroke" />
            <path d="M44 51 V30" vectorEffect="non-scaling-stroke" />
            {/* rules down to the agent */}
            <path d="M12 44 V50" vectorEffect="non-scaling-stroke" />
            {/* tariff platform up and into the second system */}
            <path d="M58.5 73 V57 H49" vectorEffect="non-scaling-stroke" />
            {/* the agent down to the vendors' agents */}
            <path d="M21 66 V70.5 M10 73.5 V70.5 H27 V73.5" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        <Head x={33} y={50} dir="down" />
        <Head x={44} y={30} dir="up" />
        <Head x={12} y={50} dir="down" />
        <Head x={49} y={57} dir="left" />
        <Head x={10} y={73.5} dir="down" />
        <Head x={27} y={73.5} dir="down" />

        {/* Tier 1: the group system, drawn as a cloud */}
        <div className="absolute rounded-[40px] border border-[#7fd4ff]/50 bg-gradient-to-b from-[#2a6fe0]/45 to-[#0e2f6e]/55 shadow-[0_0_14px_rgba(80,170,255,.35),inset_0_0_12px_rgba(140,200,255,.2)]" style={at(3, 0, 62, 30)} />
        <div className="absolute text-center text-[9.5px] leading-none text-cyan-50/90" style={at(3, 2.5, 62)}><T>Group System</T></div>
        <div className={node} style={at(6, 8, 15, 19)}><T>MaaS Platform</T></div>
        <div className={cn(node, 'flex-col gap-0.5 px-1.5')} style={at(22.5, 8, 39.5, 19)}>
          <T>AI Platform</T>
          {/* two equal halves, each name centred and wrapped inside its half, so neither touches the border */}
          <span className="grid w-full grid-cols-2 gap-1 text-center text-[9.5px] [overflow-wrap:anywhere] font-medium leading-tight text-amber-300">
            <T>Registry Center</T>
            <T>Orchestration Center</T>
          </span>
        </div>

        {/* Tier 2: the energy-saving agent and its rules */}
        <div className={green} style={at(5, 36, 25, 9)}><T>Energy-Saving Rules</T></div>
        <div className="absolute text-[9.5px] leading-none text-cyan-50/80" style={at(14, 46, 12)}><T>skills</T></div>
        <div className={cn(node, 'gap-1.5 border-[#7fd4ff]/70 bg-[#1a5fd6]/45 shadow-[0_0_10px_rgba(80,170,255,.4)]')} style={at(5, 51, 31, 15)}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[#7fd4ff]/70 bg-[#1a5fd6]/70">
            <Bot className="size-4 text-cyan-50" aria-hidden="true" />
          </span>
          <T className="font-medium">Energy-Saving Agent</T>
        </div>
        <div className={cn(node, 'px-0')} style={at(40, 51, 9, 12)}>
          <ReceiptText className="size-4 text-cyan-100" aria-hidden="true" />
        </div>

        {/* Tier 3: the vendors, reached over A2A-T */}
        <div className="absolute text-[10.5px] font-medium leading-none text-amber-300" style={at(29, 69.5, 10)}>A2A-T</div>
        <Agent style={at(2.5, 74.5, 15)}><T>Wireless Network Agent</T></Agent>
        <Agent style={at(19.5, 74.5, 15)}><T>Other Energy-Saving Agents</T></Agent>
        <div className="absolute text-[11px] leading-tight text-cyan-50" style={at(38, 82, 11)}><T>Other Vendors</T></div>
        <div className={cn(green, "px-1")} style={at(49.5, 73, 18, 20)}><T>Tariff Management Platform</T></div>
        </div>
      </div>
    </Frame>
  )
}

/** A stage of the timeline: `up` stages sit above the arrow (name, box, line), the others below it (line, box, name). */
const MID = 46

function Stage({ x, up, name, children }: { x: number; up?: boolean; name: string; children: ReactNode }) {
  const line = <span aria-hidden="true" className="min-h-[6px] w-px flex-1 border-l border-dashed border-cyan-300/70" />
  const box = <div className="w-full rounded border border-[#4f9dff]/60 bg-[#0e2f6e]/75 px-1 py-1 text-center text-[10px] leading-tight text-cyan-50">{children}</div>
  return (
    <li className={cn('absolute flex flex-col items-center gap-1', up ? 'justify-end pb-[5px]' : 'pt-[5px]')} style={{ left: `${x - (up ? 10 : 13)}%`, width: up ? '20%' : '26%', top: up ? 0 : `${MID}%`, height: `${up ? MID : 100 - MID}%` }}>
      {up ? (
        <>
          <span className="text-center text-[11px] leading-tight text-cyan-50"><T>{name}</T></span>
          {box}
          {line}
        </>
      ) : (
        <>
          <span aria-hidden="true" className="h-[9px] w-px shrink-0 border-l border-dashed border-cyan-300/70" />
          {box}
          <span className="text-center text-[11px] font-medium leading-tight text-amber-300"><T>{name}</T></span>
        </>
      )}
    </li>
  )
}

function Fast({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[17px] font-medium leading-none text-amber-300 tabular-nums"><T>{value}</T></div>
      <div className="text-[12px] leading-tight text-cyan-50"><T>{label}</T></div>
      {/* The bracket under the figure. */}
      <span aria-hidden="true" className="mt-1 flex w-[72%] items-center">
        <span className="h-px flex-1 bg-cyan-300/60" />
        <span className="h-1 w-6 rounded-full bg-cyan-300/80" />
        <span className="h-px flex-1 bg-cyan-300/60" />
      </span>
    </div>
  )
}

/** Right, lower: intent-driven end-to-end autonomous energy saving, from the tariff to the effect. */
export function AutonomousSavingPanel({ className }: { className?: string }) {
  return (
    <Frame title="Intent-Driven End-to-End Autonomous Energy Saving @ Fast Service Launch" className={className}>
      <div className="flex h-full min-h-0 flex-col gap-1.5">
        <div className="grid shrink-0 grid-cols-2 gap-2 pt-0.5">
          <Fast value={t('< 1 week')} label={t('Energy-Saving Agent Dev')} />
          <Fast value={t('< 1 day')} label={t('Vendor Agent Integration')} />
        </div>
        <ol className="relative min-h-0 flex-1">
          {/* The arrow the five stages sit on, with a dot for each. */}
          <li aria-hidden="true" className="absolute inset-x-[2%] flex -translate-y-1/2 items-center" style={{ top: `${MID}%` }}>
            <span className="h-[3px] flex-1 rounded bg-gradient-to-r from-cyan-300/40 to-cyan-300" />
            <ArrowRight className="-ml-2 size-4 text-cyan-300" />
          </li>
          {[10, 30, 50, 70, 90].map((x) => (
            <li key={x} aria-hidden="true" className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(120,220,255,.9)]" style={{ left: `${x}%`, top: `${MID}%` }} />
          ))}
          <Stage x={10} up name={t('Data Perception')}><T>Obtain dynamic time-of-use tariff</T></Stage>
          <Stage x={30} name={t('Value Decision')}>
            <ul className="list-disc pl-3 text-left">
              <li><T>Intent Understanding</T></li>
              <li><T>Global Strategy Formulation</T></li>
            </ul>
          </Stage>
          <Stage x={50} up name={t('Orchestration Scheduling')}><T>Break into orchestratable workflows</T></Stage>
          <Stage x={70} name={t('Network Element Execution')}><T>Generate & dispatch granular energy-saving strategy</T></Stage>
          <Stage x={90} up name={t('Effect Evaluation')}><T>Evaluate energy-saving effect</T></Stage>
        </ol>
      </div>
    </Frame>
  )
}

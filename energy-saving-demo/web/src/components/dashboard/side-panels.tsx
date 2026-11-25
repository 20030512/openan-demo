// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { ArrowDown, ArrowUp, CalendarDays, ClipboardCheck, LayoutGrid, Leaf, Network, RadioTower, Target, Zap, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { T, t, useTr } from '@/lib/i18n'
import { useLoad } from '@/lib/use-load'
import { Panel, Cap, ErrorNote, Sub } from './panel'
import { DONUT, Donut, DualAxisChart, Legend, LineChart, PALETTE } from './charts'

const fmt = (n: number) => n.toLocaleString('en-US')
const Loading = () => <p className="text-xs text-muted-foreground"><T>Loading…</T></p>

const box = 'rounded-lg border border-[#2f7bff]/30 bg-[#0a2457]/55'

function Stat({ icon: Icon, label, value, unit, accent }: { icon: LucideIcon; label: string; value: string | number; unit?: string; accent?: boolean }) {
  return (
    <div className={`${box} flex items-center gap-3 px-3 py-1.5`}>
      <Icon className={accent ? 'size-6 text-teal-300' : 'size-6 text-sky-400'} aria-hidden="true" />
      <div>
        <Cap>{label}</Cap>
        <div className={`mt-0.5 text-2xl font-semibold leading-none tabular-nums ${accent ? 'text-teal-300' : 'text-white'}`}>
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-cyan-100/70">{unit}</span>}
        </div>
      </div>
    </div>
  )
}

const METRIC_ICONS: LucideIcon[] = [Network, LayoutGrid, CalendarDays]

/** UC2 2.2 Overall energy statistics (left, upper). */
export function EnergySummaryPanel({ className }: { className?: string }) {
  const { data, error, reload } = useLoad(api.energySummary)
  const tr = useTr()
  return (
    <Panel title="Overall energy statistics" className={className}>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <Sub title="Energy-saving gain overview" />
          <div className="grid grid-cols-[minmax(0,0.87fr)_minmax(0,1.13fr)] gap-1.5">
            <Stat icon={Zap} label="Energy" value={data.currentConsumption} unit="kWh" />
            <Stat icon={Leaf} label="Total saving gain" value={`${data.totalEnergySavingGain}%`} accent />
          </div>
          {/* Same columns (the left one narrower) and gap as the boxes above, so the four boxes line up in columns and rows. */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.87fr)_minmax(0,1.13fr)] gap-1.5">
            <div className={`${box} flex min-h-0 min-w-0 flex-col gap-1 p-2`}>
              <Sub title="Energy metrics" />
              <table className="min-h-0 w-full flex-1 text-sm">
                <caption className="sr-only">{tr(t('Energy metrics'))}</caption>
                <tbody>
                  {data.metrics.map((m, k) => {
                    const Icon = METRIC_ICONS[k % METRIC_ICONS.length]
                    return (
                      <tr key={m.label} className="border-t border-white/10 first:border-0">
                        <th scope="row" className="whitespace-nowrap py-0 pr-1 text-left text-[10.5px] font-normal leading-tight text-cyan-100/85">
                          <Icon className="mr-0.5 inline size-3 text-sky-400" aria-hidden="true" />
                          <T>{m.label}</T>
                        </th>
                        <td className="whitespace-nowrap py-0 pl-1 text-right font-mono text-[11px] tracking-tight tabular-nums">
                          {fmt(m.value)}
                          <span className="text-[9px] text-cyan-100/60">{m.unit}</span>
                        </td>
                        {/* The arrow has its own column so it keeps clear of the unit and of the box edge. */}
                        <td className="w-4 py-0 pl-1 pr-1 text-right">
                          {m.trend === 'up' ? (
                            <ArrowUp className="inline size-3 text-red-400" aria-label={tr('up')} />
                          ) : (
                            <ArrowDown className="inline size-3 text-teal-300" aria-label={tr('down')} />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${box} flex min-h-0 min-w-0 flex-col gap-1 p-2`}>
              <Sub title="Energy-saving gain by RAT" />
              <div className="flex min-h-0 flex-1 items-center gap-1.5">
                {/* The ring takes the width the lines leave free (up to the height of the box), so it is as big as each screen allows. */}
                <div className="flex min-h-0 min-w-[56px] flex-1 basis-0 items-center justify-center self-stretch">
                <Donut
                  className="aspect-square h-[90%] max-h-[90%] max-w-[90%]"
                  modes={data.gainDistribution.modes}
                  desc={data.gainDistribution.modes.map((m) => `${m.name} ${m.value} ${data.gainDistribution.unit} | ${m.percent}%`).join(', ')}
                >
                  {/* Fixed pixel sizes: the text must stay inside the ring in both languages, so the Chinese size bump is not applied here. */}
                  <div className="max-w-[85%] leading-none">
                    <div style={{ fontSize: 13 }} className="font-semibold">{data.gainDistribution.totalSaving}</div>
                    {/* May wrap in English ("Total saving" is wider than 总节能) so it stays inside the ring. */}
                    <div style={{ fontSize: 11 }} className="mt-1 leading-tight text-cyan-100/80"><T>Total saving</T></div>
                    <div style={{ fontSize: 11 }} className="leading-tight text-cyan-100/80">({data.gainDistribution.unit})</div>
                  </div>
                </Donut>
                </div>
                {/* A round dot and the RAT name, then "8245.67kWh | 80.8%" under it. */}
                <ul className="min-w-0 shrink space-y-3 pr-1">
                  {data.gainDistribution.modes.map((m, k) => (
                    <li key={m.name} className="min-w-0 whitespace-nowrap leading-tight tabular-nums text-cyan-100/85">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                        <i className="size-2 shrink-0 rounded-full" style={{ background: DONUT[k % DONUT.length] }} />
                        {m.name}
                      </div>
                      <span className="block truncate pl-3.5 text-[10px] tracking-tight" title={`${m.name} ${m.value} ${data.gainDistribution.unit} | ${m.percent}%`}>
                        {m.value}{data.gainDistribution.unit} | {m.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

const KPI_ICONS: LucideIcon[] = [ClipboardCheck, Target, RadioTower, RadioTower]

/** UC2 2.4 Key performance indicators (right, upper). */
export function KpiPanel({ className }: { className?: string }) {
  const { data, error, reload } = useLoad(api.kpi)
  return (
    <Panel title="Key performance indicators" className={className}>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <Sub title="Optimization suggestion generation and execution" />
          <div className="grid shrink-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5">
            {data.suggestionCards.map((c, k) => {
              const Icon = KPI_ICONS[k % KPI_ICONS.length]
              return (
                <div key={k} className={`${box} flex min-w-0 items-center gap-1.5 px-2 py-0.5`}>
                  <Icon className="size-4 shrink-0 text-sky-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <Cap>{c.label}</Cap>
                    <div className="whitespace-nowrap font-mono text-[13px] font-semibold leading-tight tracking-tighter tabular-nums">
                      {c.executed}
                      <span className="text-cyan-100/70">/{c.total}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <Sub title="Suggestion delivery trend" />
          <div className={`${box} flex min-h-0 flex-1 flex-col gap-1 p-1.5`}>
            <LineChart
              className="min-h-[40px] flex-1"
              xAxis={data.trendChart.xAxis}
              series={data.trendChart.series}
              yMax={5000}
              yTicks={[0, 2500, 5000]}
              every={2}
              desc="Suggestion, execution and difference counts per day"
            />
            <div className="flex justify-center">
              <Legend items={data.trendChart.series.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length] }))} />
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** UC2 2.5 Site energy consumption curves (right, lower). */
export function EnergyCurvesPanel({ className }: { className?: string }) {
  const { data, error, reload } = useLoad(api.energyCurves)
  const tr = useTr()
  return (
    <Panel title="Site energy curves" className={className}>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className={`${box} flex min-h-0 flex-1 flex-col gap-1 p-1.5`}>
            <Sub title="Energy trend (kWh)" aside={<span className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-cyan-100/80"><T>Last 7 days</T></span>} />
            <Legend items={data.energyTrend.series.map((s, k) => ({ name: s.name, color: PALETTE[k % PALETTE.length] }))} />
            <LineChart
              className="min-h-[48px] flex-1"
              xAxis={data.energyTrend.xAxis}
              series={data.energyTrend.series}
              yMax={300}
              yTicks={[0, 150, 300]}
              desc="Total, 5G and 4G energy consumption over the last 7 days"
            />
          </div>
          <div className={`${box} flex min-h-0 flex-1 flex-col gap-1 p-1.5`}>
            <Sub title="Electricity price vs Li-ion discharge" aside={<span className="font-mono text-[11px] text-cyan-100/70">{data.priceDischarge.date}</span>} />
            <Legend
              items={[
                { name: t('Electricity price (CNY), left axis'), color: PALETTE[0] },
                { name: t('Average discharge (kWh), right axis'), color: PALETTE[2] },
              ]}
            />
            <DualAxisChart
              className="min-h-[48px] flex-1"
              xAxis={data.priceDischarge.xAxis}
              price={data.priceDischarge.price}
              discharge={data.priceDischarge.discharge}
              leftTitle={tr(t('Price (CNY)'))}
              rightTitle={tr(t('Discharge (kWh)'))}
              desc="Electricity price in CNY against average Li-ion discharge in kWh across the day"
            />
          </div>
        </div>
      )}
    </Panel>
  )
}

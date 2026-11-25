// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { PriceBars } from '@/components/dashboard/charts'
import { ErrorNote, Panel } from '@/components/dashboard/panel'
import { api, type AlgorithmExample } from '@/lib/api'
import { T, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import web from '../../package.json'
import server from '../../../server/package.json'

const P = ({ children }: { children: string }) => <p className="max-w-3xl text-sm leading-relaxed"><T>{children}</T></p>

function Table({ head, rows, mono }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-xs">
        <thead className="bg-[#0e1d3a]">
          <tr className="text-left text-muted-foreground">
            {head.map((h) => <th key={h} scope="col" className="p-2 align-bottom"><T>{h}</T></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/8 align-top">
              {r.map((c, j) => <td key={j} className={cn('p-2', mono?.includes(j) && 'font-mono')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Tx = ({ children }: { children: string }) => <T>{children}</T>

/** Short line with the version of a dependency, read from the real package.json files. */
const ver = (pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, name: string) =>
  (pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '').replace(/^[\^~]/, '')

const Box = ({ title, children, accent }: { title: string; children?: string; accent?: boolean }) => (
  <div className={cn('rounded-2xl border p-3 text-center text-xs', accent ? 'border-primary/60 bg-primary/10' : 'border-white/12 bg-white/5')}>
    <div className="font-semibold"><T>{title}</T></div>
    {children && <div className="mt-1 text-muted-foreground"><T>{children}</T></div>}
  </div>
)

function Layout() {
  const cell = 'rounded-xl border border-white/12 bg-white/5 p-2 text-center text-[11px]'
  return (
    <div className="max-w-3xl space-y-2" role="img" aria-label="Wireframe: title bar above three columns">
      <div className={cn(cell, 'border-primary/50')}><T>Title bar: Energy-Saving Agent, clock</T></div>
      <div className="grid grid-cols-[1fr_1.1fr_1fr] gap-2">
        <div className="space-y-2">
          <div className={cn(cell, 'h-20')}><T>Overall energy statistics</T><div className="text-muted-foreground">2.2</div></div>
          <div className={cn(cell, 'h-28')}><T>Energy-saving task dispatch</T><div className="text-muted-foreground">2.3</div></div>
        </div>
        <div className={cn(cell, 'flex items-center justify-center bg-[#0c1a33]')}><div><T>Central city map</T><div className="text-muted-foreground">2.6</div></div></div>
        <div className="space-y-2">
          <div className={cn(cell, 'h-20')}><T>Key performance indicators</T><div className="text-muted-foreground">2.4</div></div>
          <div className={cn(cell, 'h-28')}><T>Site energy curves</T><div className="text-muted-foreground">2.5</div></div>
        </div>
      </div>
    </div>
  )
}

function Architecture() {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
      <Box title="Browser" accent>React page, hash router</Box>
      <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
      <Box title="REST over HTTP">JSON, one /api prefix</Box>
      <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
      <Box title="Fastify server" accent>routes and the strategy algorithm</Box>
      <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
      <Box title="SQLite file">node:sqlite, 4 tables</Box>
    </div>
  )
}

function Example() {
  const [ex, setEx] = useState<AlgorithmExample | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.algorithmExample().then(setEx, (e: Error) => setErr(e.message)) }, [])
  if (err) return <ErrorNote message={err} />
  if (!ex) return <p className="text-xs text-muted-foreground"><T>Loading…</T></p>
  const low = ex.stages.filter((s) => s === 'LOW').length
  const peak = ex.stages.filter((s) => s === 'PEAK').length
  return (
    <div className="max-w-3xl space-y-2">
      <PriceBars prices={ex.prices} stages={ex.stages} desc="Design doc example: 24 hourly prices, coloured by chosen stage" />
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <p className="text-xs text-muted-foreground">
        <T s="Charge {m} min, discharge {n} min, hourly slots: the algorithm picks {peak} PEAK slots and {low} LOW slots, the rest stay FLAT." v={{ m: ex.chargeMin, n: ex.dischargeMin, peak, low }} />
      </p>
    </div>
  )
}

const Sec = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <Panel title={title} aside={<span className="font-mono text-xs text-muted-foreground">§{n}</span>}>
    <div className="space-y-4">{children}</div>
  </Panel>
)

const H = ({ children }: { children: string }) => <h3 className="text-sm font-semibold text-primary"><T>{children}</T></h3>

const BACKEND = [
  ['Node.js', `>= 22.13`, t('Runtime. The built-in SQLite module needs this version.')],
  ['TypeScript', ver(server, 'typescript'), t('One language for server and page; strict mode.')],
  ['fastify', ver(server, 'fastify'), t('HTTP server and routing.')],
  ['@fastify/multipart', ver(server, '@fastify/multipart'), t('Reads uploaded .xlsx files (UC1 import, kept for the API).')],
  ['@fastify/static', ver(server, '@fastify/static'), t('Serves the built React page.')],
  ['node:sqlite', t('built in'), t('Database. No driver to install, one file on disk.')],
  ['exceljs', ver(server, 'exceljs'), t('Reads and writes .xlsx files.')],
  ['vitest', ver(server, 'vitest'), t('Server tests, run against the real app in memory.')],
]
const FRONTEND = [
  ['React', ver(web, 'react'), t('Components and state.')],
  ['Vite', ver(web, 'vite'), t('Dev server and the production build.')],
  ['Tailwind CSS', ver(web, 'tailwindcss'), t('Utility styling; colours are CSS variables.')],
  ['shadcn-style ui', t('local files'), t('Button and Dialog in components/ui, built on Radix primitives.')],
  ['@radix-ui/react-dialog', ver(web, '@radix-ui/react-dialog'), t('Accessible modal (focus trap, Escape to close).')],
  ['lucide-react', ver(web, 'lucide-react'), t('Icons.')],
  ['TypeScript', ver(web, 'typescript'), t('Types shared in spirit with the server (lib/api.ts).')],
  ['vitest', ver(web, 'vitest'), t('Checks that every English text has a Chinese line.')],
]

const API = [
  ['GET', '/api/energy-saving/dashboard/energy-summary', t('Statistics panel (fixed demo data)')],
  ['GET', '/api/energy-saving/dashboard/kpi', t('KPI cards and trend (fixed demo data)')],
  ['GET', '/api/energy-saving/dashboard/energy-curves', t('Energy and price curves (fixed demo data)')],
  ['POST', '/api/energy-saving/task/submit', t('Submit the energy-saving intent, returns a task id')],
  ['GET', '/api/energy-saving/effect', t('Effect report shown in the pop-up (fixed demo data)')],
  ['GET', '/api/energy-saving/query?day=', t('Prices and LOW/PEAK plan of one day, from the latest batch')],
  ['GET/POST', '/api/test-data', t('List or create datasets')],
  ['GET/PUT/DELETE', '/api/test-data/:id', t('Read, edit or delete one dataset')],
  ['POST', '/api/test-data/:id/preview', t('Run the algorithm on a dataset, with unsaved edits, without storing')],
  ['POST', '/api/test-data/:id/apply', t('Store the dataset as the latest price batch and generate its strategy')],
  ['POST', '/api/test-data/:id/duplicate', t('Copy a dataset')],
  ['POST', '/api/test-data/reset', t('Delete all datasets and restore the built-in ones')],
  ['GET', '/api/algorithm/example', t('The design doc worked example and the stages chosen')],
  ['GET', '/health', t('Status and version')],
]

const TABLES = [
  ['price_data', t('Reused from UC1'), t('One row per price slot: batch_id, date, slot, time_slot, price_value. Only the latest batch is read.')],
  ['charge_discharge_strategy', t('Reused from UC1'), t('Merged rows per day: batch_id, date, start_time, end_time, stage.')],
  ['system_config', t('Reused from UC1'), t('Charge and discharge minutes and price granularity; set when a dataset is applied.')],
  ['test_dataset', t('New'), t('A named scenario: price days as JSON, profile, charge and discharge minutes, granularity, first-day offset.')],
]

const SEQUENCE = [
  ['1', t('User clicks Send'), t('The user message is shown and the submit API is called.')],
  ['2', t('Immediately after'), t('"Dispatching energy-saving intent" appears above the message.')],
  ['3', t('After 2 seconds'), t('It changes to "Energy-saving intent dispatched".')],
  ['4', t('Dispatch succeeded'), t('A status card appears with a yellow dot (in progress).')],
  ['5', t('Dispatch succeeded'), t('Progress rises from 0% to 100% in 5 seconds, +20% every second (a front-end timer).')],
  ['6', t('After 5 seconds'), t('The dot turns green: execution complete.')],
  ['7', t('Progress at 100%'), t('The "Completed" link appears.')],
  ['8', t('Click "Completed"'), t('A pop-up shows the energy-saving effect report.')],
  ['9', t('Dispatch succeeded'), t('Two recommended questions appear.')],
  ['10', t('Click a recommended question'), t('The day query API runs and the price table and the plan table are shown.')],
]

const STEPS = [
  t('Group the latest price batch by day. Each day is a list of prices, one per slot.'),
  t('If every price is equal, every slot is FLAT and there is no strategy.'),
  t('Turn the durations into slot counts: N = discharge minutes / 60 / granularity and M = charge minutes / 60 / granularity (at least 1).'),
  t('Discharge options: (a) one window of N slots with the highest price sum, keeping the last M slots free; (b) two windows totalling N slots, each at least one slot and at least 2 hours apart, with the highest sum. If the second window reaches the final slot it is moved 2 hours earlier and those last 2 hours are reserved for charging.'),
  t('For each discharge option, find the cheapest charging: one window of the remaining M slots, or two windows with a discharge between them and a gap above 2 hours.'),
  t('Score each option as discharge price sum minus charge price sum and keep the best one.'),
  t('Mark the discharge slots PEAK and the charge slots LOW; everything else is FLAT. With exactly two price levels FLAT is replaced by LOW (cheap) or PEAK (expensive).'),
  t('Merge neighbouring slots with the same stage into rows of start time and end time.'),
]

const CONTRAST = [
  [t('Back-end language'), t('TypeScript: skills, controllers and services under src/'), t('TypeScript on Fastify: routes, services and the algorithm, in a smaller layout'), t('Same language, fewer layers')],
  [t('Task dispatch'), t('Parse the intent with an LLM, build a Task-T template, call the A2A interface with an MAE token'), t('Checks the text and returns a task id'), t('Not built: LLM, A2A and MAE need systems this demo does not have')],
  [t('Recommended questions'), t('Sent to the AI through the harness dialog interface'), t('A direct day-query API on the stored prices and plan'), t('Same result tables, no AI in between')],
  [t('Dashboard statistics, KPI, curves'), t('Fixed data from three interfaces'), t('The same fixed data'), t('As designed')],
  [t('Energy-saving status and progress'), t('Local front-end timer, no storage'), t('Local front-end timer, no storage'), t('As designed')],
  [t('Central map'), t('3D city bird\'s-eye view'), t('SVG skyline with pulsing site lights'), t('Visual background only, as designed')],
  [t('Price and strategy data'), t('Reuse the UC1 tables'), t('The same tables, filled from managed test datasets'), t('One new table: test_dataset')],
  [t('Recommended question 2'), t('Section 2.3: today; section 5: yesterday'), t('Yesterday (section 5)'), t('The design contradicts itself; section 5 is the detailed one')],
]

export function DesignPage() {
  return (
    <div className="space-y-4">
      <Sec n={1} title="Scope: UC2 only">
        <P>This site is UC2, the Energy-Saving Agent dashboard from the Energy-Saving UC software design. UC1's own screens are not part of it.</P>
        <P>UC2 owns no price or strategy data. It reuses the tables UC1 defines. Here they are filled from managed test datasets, so every answer the agent gives can be repeated.</P>
      </Sec>

      <Sec n={2} title="Page layout">
        <P>A title bar over three columns, as in section 2.1 of the design. The numbers are the design sections.</P>
        <Layout />
      </Sec>

      <Sec n={3} title="How it is built">
        <Architecture />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <H>Front end (web/src)</H>
            <Table head={['Part', 'Role']} mono={[0]} rows={[
              ['App.tsx', <Tx key="a">Hash router: dashboard, test data, design</Tx>],
              ['top-header.tsx', <Tx key="b">Title bar, clock, page links, language switch</Tx>],
              ['side-panels.tsx', <Tx key="c">Statistics, KPI and curves panels</Tx>],
              ['agent-dialog.tsx', <Tx key="d">Task dialog: the 10-step sequence, tables, effect pop-up</Tx>],
              ['city-map.tsx', <Tx key="e">Generated SVG skyline</Tx>],
              ['charts.tsx', <Tx key="f">Line, dual-axis, ring and price-bar charts in plain SVG</Tx>],
              ['pages/test-data.tsx', <Tx key="g">Dataset list, editor, preview and apply</Tx>],
              ['lib/i18n.tsx', <Tx key="h">The component that adds a Chinese line under English text</Tx>],
              ['lib/api.ts', <Tx key="i">Typed calls to every endpoint</Tx>],
            ]} />
          </div>
          <div className="space-y-2">
            <H>Back end (server/src)</H>
            <Table head={['Part', 'Role']} mono={[0]} rows={[
              ['app.ts', <Tx key="a">Builds the server, error format, static files</Tx>],
              ['db.ts', <Tx key="b">Opens SQLite, creates tables, transactions</Tx>],
              ['strategy.ts', <Tx key="c">The charge/discharge strategy algorithm</Tx>],
              ['test-data.ts', <Tx key="d">Price generators, built-in scenarios, preview</Tx>],
              ['routes/energy-saving.ts', <Tx key="e">The UC2 dashboard, task and query endpoints</Tx>],
              ['routes/test-data.ts', <Tx key="f">Dataset management endpoints</Tx>],
              ['routes/charge-discharge.ts', <Tx key="g">UC1 config, import and export endpoints (kept, not used by this page)</Tx>],
            ]} />
          </div>
        </div>
      </Sec>

      <Sec n={4} title="Algorithm 1: task dispatch dialog">
        <P>Everything in the dialog appears from the bottom up, above the fixed input box.</P>
        <Table head={['Step', 'Trigger', 'Behaviour']} mono={[0]} rows={SEQUENCE.map(([a, b, c]) => [a, <Tx key="b">{b}</Tx>, <Tx key="c">{c}</Tx>])} />
      </Sec>

      <Sec n={5} title="Algorithm 2: charge/discharge strategy">
        <P>The strategy behind "Li-ion battery charge/discharge slots". It runs once per day of prices and picks the plan that earns the most.</P>
        <ol className="max-w-3xl list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
          {STEPS.map((s) => <li key={s}><T>{s}</T></li>)}
        </ol>
        <Example />
        <P>Window searches slide over the day. The two-window search tries every pair, which is fine for a day of at most 96 slots. Rounding is half to even, so 2.5 slots becomes 2.</P>
      </Sec>

      <Sec n={6} title="What was used">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <H>Back end</H>
            <Table head={['Tool', 'Version', 'Why']} mono={[0, 1]} rows={BACKEND.map(([a, b, c]) => [a, b, <Tx key="c">{c}</Tx>])} />
          </div>
          <div className="space-y-2">
            <H>Front end</H>
            <Table head={['Tool', 'Version', 'Why']} mono={[0, 1]} rows={FRONTEND.map(([a, b, c]) => [a, b, <Tx key="c">{c}</Tx>])} />
          </div>
        </div>
        <P>Not used on purpose: no chart library (the charts are plain SVG), no router or state library, no ORM.</P>
      </Sec>

      <Sec n={7} title="API">
        <Table head={['Method', 'Path', 'Purpose']} mono={[0, 1]} rows={API.map(([a, b, c]) => [a, b, <Tx key="c">{c}</Tx>])} />
      </Sec>

      <Sec n={8} title="Data">
        <Table head={['Table', 'Origin', 'Content']} mono={[0]} rows={TABLES.map(([a, b, c]) => [a, <Tx key="b">{b}</Tx>, <Tx key="c">{c}</Tx>])} />
      </Sec>

      <Sec n={9} title="Design versus what was built">
        <Table head={['Item', 'Design says', 'Built', 'Note']} rows={CONTRAST.map(([a, b, c, d]) => [<Tx key="a">{a}</Tx>, <Tx key="b">{b}</Tx>, <Tx key="c">{c}</Tx>, <Tx key="d">{d}</Tx>])} />
      </Sec>

      <Sec n={10} title="Using the test data">
        <ol className="max-w-3xl list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
          <li><T>Open Test data and pick a dataset, or create one from a price shape.</T></li>
          <li><T>Edit any price. The strategy preview updates as you type.</T></li>
          <li><T>Press Apply as latest price batch.</T></li>
          <li><T>Go to the dashboard and ask the agent for today's or yesterday's prices.</T></li>
        </ol>
      </Sec>
    </div>
  )
}

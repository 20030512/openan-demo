// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, CircleDollarSign, ListChecks, Loader2, RotateCcw, Send, User, XCircle, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api, type DayQuery, type EnergyEffect, type Proposal, type TaskState } from '@/lib/api'
import { T, t, useLang, useTr, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { EffectReport } from './effect-report'
import { Panel } from './panel'

const DEFAULT_INTENT_EN =
  "Create an energy-saving task in region REGION-A; idle hours 0~6 o'clock rate guarantee target 2Mbps; during non-idle hours the downlink rate must be guaranteed to be not lower than 50MBPS. Allow enabling the Li-ion battery charge/discharge power-cost-saving function based on dynamic electricity prices, and ensure the reserved backup power ratio is not lower than 50%"

const DEFAULT_INTENT_ZH =
  '创建节能任务，区域 REGION-A；闲时 0~6 点速率保障目标 2Mbps；非闲时下行速率必须保障不低于 50Mbps。允许基于动态电价启用锂电池充放电节省电费功能，并确保备电预留比例不低于 50%'

/** The sentence in the dialog at the start: in the language of the page. */
const defaultIntent = (lang: Lang) => (lang === 'zh' ? DEFAULT_INTENT_ZH : DEFAULT_INTENT_EN)

const FUNCTIONS = [t('Create energy-saving task'), t('Query electricity price information'), t('Li-ion battery charge/discharge slot plan')] as const

const RECOMMENDED = [
  t("Query today's dynamic electricity price and Li-ion battery charge/discharge slot plan"),
  t("Query yesterday's dynamic electricity price and Li-ion battery charge/discharge slots"),
]

const FN_ICONS: LucideIcon[] = [ListChecks, CircleDollarSign, Zap]

type Show = 'price' | 'plan' | 'both'

/** Who understood the sentence: the AI model, or the built-in rules (the answer of the server says which). */
type Engine = 'llm' | 'rules'

function EngineChip({ engine }: { engine?: Engine }) {
  if (!engine) return null
  const ai = engine === 'llm'
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', ai ? 'bg-fuchsia-400/20 text-fuchsia-200' : 'bg-white/10 text-muted-foreground')}
      title={ai ? 'The AI model understood the sentence' : 'The built-in rules understood the sentence (the AI model is off, or it could not be used)'}
    >
      {ai ? <T>Understood by the AI model</T> : <T>Understood by the rules</T>}
    </span>
  )
}

/** A task the user started. Its state is the real state of the task on the server, read by its id. */
interface Run {
  kind: 'run'
  id: number
  text: string
  showText: boolean
  region: string
  /** question: the sentence named no region, so nothing was sent and the agent asks for it (there is no default region). */
  dispatch: 'dispatched' | 'failed' | 'question'
  error?: string
  taskId?: string
  state: TaskState
  progress: number
  proposal?: Proposal
  engine?: Engine
}
interface Query {
  kind: 'query'
  id: number
  engine?: Engine
  question: string
  showQuestion: boolean
  day?: string
  show?: Show
  state: 'loading' | 'ready' | 'failed' | 'unknown'
  data?: DayQuery
  error?: string
}
type Entry = Run | Query

const STATE_LABEL: Record<TaskState, string> = {
  sent: t('Sent'),
  working: t('In progress'),
  input_required: t('Waiting for your answer'),
  completed: t('Execution complete'),
  failed: t('Failed'),
  timed_out: t('Timed out'),
}
const STATE_DOT: Record<TaskState, string> = {
  sent: 'animate-pulse bg-yellow-400',
  working: 'animate-pulse bg-yellow-400',
  input_required: 'animate-pulse bg-orange-400',
  completed: 'bg-green-400',
  failed: 'bg-red-500',
  timed_out: 'bg-orange-500',
}

/** The region names at the end of the server's answer to a sentence without a region ("… Known regions: A, B."), if any. */
const knownRegions = (answer?: string) => /Known regions: (.+?)\.?$/.exec(answer ?? '')?.[1] ?? ''

function Bubble({ who, children }: { who: 'user' | 'agent'; children: React.ReactNode }) {
  return (
    <div className={cn('flex gap-2', who === 'user' && 'flex-row-reverse')}>
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/10" aria-hidden="true">
        {who === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5 text-primary" />}
      </span>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-snug',
          who === 'user' ? 'bg-primary/90 text-primary-foreground' : 'border border-white/10 bg-white/5',
        )}
      >
        {children}
      </div>
    </div>
  )
}

function Table({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption: string }) {
  return (
    <div className="max-h-44 overflow-auto rounded-xl border border-white/10">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-[#0e1d3a]">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-1.5 text-left font-mono font-semibold text-muted-foreground"><T>{h}</T></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/8">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 font-mono tabular-nums">{c === 'LOW' || c === 'PEAK' ? <StageChip s={c} /> : c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StageChip({ s }: { s: 'LOW' | 'PEAK' | 'FLAT' }) {
  const cls = s === 'LOW' ? 'bg-low/20 text-low' : s === 'PEAK' ? 'bg-peak/20 text-peak' : 'bg-flat/20 text-flat'
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)}>
      {s === 'LOW' ? <T>LOW · charge</T> : s === 'PEAK' ? <T>PEAK · discharge</T> : <T>FLAT · hold</T>}
    </span>
  )
}

function QueryResult({ q }: { q: Query }) {
  return (
    <div className="space-y-2">
      {q.showQuestion && <Bubble who="user"><T>{q.question}</T></Bubble>}
      <Bubble who="agent">
        {q.state !== 'loading' && q.state !== 'failed' && <div className="mb-1.5"><EngineChip engine={q.engine} /></div>}
        {q.state === 'loading' && (
          <span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> <T>Understanding your request…</T></span>
        )}
        {q.state === 'failed' && <span className="text-destructive">{q.error}</span>}
        {q.state === 'unknown' && <T>Sorry, I can create an energy-saving task, query electricity prices, or query the charge/discharge plan.</T>}
        {q.state === 'ready' && q.data && q.day && (
          <div className="space-y-3">
            {q.show !== 'plan' && (
              <div className="space-y-1">
                <div className="font-semibold"><T s="Dynamic electricity price · {day}" v={{ day: q.day }} /></div>
                {q.data.prices.length ? (
                  <Table head={[t('Date'), t('Time slot'), t('Price')]} caption="Dynamic electricity price" rows={q.data.prices.map((p) => [p.date, p.timeSlot, p.price.toFixed(2)])} />
                ) : (
                  <p className="text-muted-foreground"><T s="No price data for {day}. Apply a dataset on the Test data page." v={{ day: q.day }} /></p>
                )}
              </div>
            )}
            {q.show !== 'price' && (
              <div className="space-y-1">
                <div className="font-semibold"><T s="Charge/discharge plan · {day}" v={{ day: q.day }} /></div>
                {q.data.plan.length ? (
                  <Table head={[t('Date'), t('Start'), t('End'), t('Stage')]} caption="Charge and discharge plan" rows={q.data.plan.map((p) => [p.date, p.startTime, p.endTime, p.stage])} />
                ) : (
                  <p className="text-muted-foreground"><T s="No charge/discharge plan for {day}." v={{ day: q.day }} /></p>
                )}
              </div>
            )}
          </div>
        )}
      </Bubble>
    </div>
  )
}

function RunView({
  run,
  onOpenEffect,
  onAsk,
  onRetry,
  onDecide,
}: {
  run: Run
  onOpenEffect: (r: Run) => void
  onAsk: (question: string) => void
  onRetry: (text: string) => void
  onDecide: (run: Run, accept: boolean) => void
}) {
  const ended = run.state === 'failed' || run.state === 'timed_out'
  return (
    <div className="space-y-2">
      {run.showText && <Bubble who="user">{run.text}</Bubble>}
      <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
        {run.dispatch === 'dispatched' && (<><CheckCircle2 className="size-3.5 text-green-400" /> <T>Energy-saving intent dispatched</T> <span className="font-mono">{run.taskId}</span></>)}
        {run.dispatch === 'failed' && <span role="alert" className="text-destructive"><T>Dispatch failed:</T> {run.error}</span>}
        <EngineChip engine={run.engine} />
      </div>
      {run.dispatch === 'question' && (
        <Bubble who="agent">
          <T>Which region is the task for? The sentence names no region, so no task was sent. Write the region in the sentence, for example: Create an energy-saving task in region X, downlink not lower than 30Mbps.</T>
          {knownRegions(run.error) && <span className="mt-1 block text-muted-foreground"><T>Known regions:</T> {knownRegions(run.error)}</span>}
        </Bubble>
      )}
      {run.dispatch === 'dispatched' && (
        <>
          <div className="ml-8 rounded-2xl border border-white/10 bg-white/5 p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span className={cn('size-2.5 rounded-full', STATE_DOT[run.state])} aria-hidden="true" />
              <T s="{region} region energy-saving status" v={{ region: run.region }} />
              <span className="font-normal text-muted-foreground">· <T>{STATE_LABEL[run.state]}</T></span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={run.progress}
                aria-label="Power-saving effect progress"
              >
                <div className={cn('h-full rounded-full transition-[width] duration-700', ended ? 'bg-red-500' : 'bg-primary')} style={{ width: `${run.progress}%` }} />
              </div>
              <span className="w-9 text-right font-mono text-xs tabular-nums">{run.progress}%</span>
              {run.state === 'completed' && (
                <button type="button" onClick={() => onOpenEffect(run)} className="text-xs font-semibold text-primary underline underline-offset-2">
                  <T>Completed</T>
                </button>
              )}
            </div>
            {run.state === 'input_required' && run.proposal && (
              <div role="group" aria-label="Proposal from the Network Agent" className="mt-2 rounded-xl border border-orange-400/50 bg-orange-400/10 p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <T>Proposal from the Network Agent</T>
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-red-300"><T>Risk: HIGH</T></span>
                </div>
                <p className="mt-1"><T>{run.proposal.summary}</T></p>
                <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 font-mono tabular-nums">
                  <dt className="font-sans text-muted-foreground"><T>Energy-saving gain target</T></dt>
                  <dd>{run.proposal.savingTarget.from}{run.proposal.savingTarget.unit} → {run.proposal.savingTarget.to}{run.proposal.savingTarget.unit}</dd>
                  <dt className="font-sans text-muted-foreground"><T>Speed guarantee</T></dt>
                  <dd>{run.proposal.speedGuarantee.from} → {run.proposal.speedGuarantee.to} {run.proposal.speedGuarantee.unit}</dd>
                </dl>
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" onClick={() => onDecide(run, true)}><T>Accept</T></Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onDecide(run, false)}><T>Reject</T></Button>
                </div>
              </div>
            )}
            {ended && (
              <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
                <XCircle className="size-3.5" aria-hidden="true" />
                <span>{run.error}</span>
                <button type="button" onClick={() => onRetry(run.text)} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                  <RotateCcw className="size-3" aria-hidden="true" /> <T>Retry</T>
                </button>
              </div>
            )}
          </div>
          <div className="ml-8 flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground"><T>Recommended questions</T></span>
            {RECOMMENDED.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onAsk(r)}
                className="rounded-xl border border-primary/40 px-3 py-1.5 text-left text-xs text-primary transition-colors hover:bg-primary/10"
              >
                <T>{r}</T>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** UC2 2.3 Energy-saving task dispatch dialog. Messages grow upward from the fixed input (2.7). */
export function AgentDialog({ className }: { className?: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const { lang } = useLang()
  const tr = useTr()
  // The box starts empty: a button only puts a sentence in it, the user sends it.
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [effect, setEffect] = useState<{ region: string; data?: EnergyEffect; error?: string } | null>(null)
  const seq = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setInterval>>())
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ts = timers.current
    return () => ts.forEach(clearInterval)
  }, [])
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [entries])

  const patch = useCallback((id: number, p: Partial<Run> | Partial<Query>) => {
    setEntries((es) => es.map((e) => (e.id === id ? ({ ...e, ...p } as Entry) : e)))
  }, [])

  /**
   * One entry for everything typed or clicked: the server's intent router lists what the text asks for, and the
   * actions come back in order (design doc 1.2). A task is then followed by its id until the server says it is final.
   */
  const send = async (input = text) => {
    const userInput = input.trim()
    if (!userInput || sending) return // empty text is never sent, and one request at a time
    setSending(true)
    setText('') // what was sent leaves the box
    const id = ++seq.current
    // Show something at once; it is replaced by the real entries when the answer arrives, however long that takes.
    setEntries((es) => [...es, { kind: 'query', id, question: userInput, showQuestion: true, state: 'loading' }])
    try {
      const r = await api.chat(userInput)
      const made: Entry[] = r.actions.map((a, i): Entry => {
        const eid = i === 0 ? id : ++seq.current
        const first = i === 0
        if (a.kind === 'task') {
          return {
            kind: 'run', id: eid, text: userInput, showText: first, region: a.params.region, progress: 0,
            dispatch: a.success ? 'dispatched' : a.params.region ? 'failed' : 'question', error: a.success ? undefined : a.message,
            taskId: a.success ? a.taskId : undefined, state: 'sent', engine: r.engine,
          }
        }
        if (a.kind === 'unknown') return { kind: 'query', id: eid, question: userInput, showQuestion: first, state: 'unknown', engine: r.engine }
        return { kind: 'query', id: eid, question: userInput, showQuestion: first, engine: r.engine, state: 'ready', day: a.day, show: a.intent === 'query-price' ? 'price' : a.intent === 'query-plan' ? 'plan' : 'both', data: a }
      })
      setEntries((es) => es.flatMap((e) => (e.id === id ? made : [e])))
      for (const e of made) if (e.kind === 'run' && e.taskId) follow(e.id, e.taskId)
    } catch (e) {
      patch(id, { state: 'failed', error: (e as Error).message })
    } finally {
      setSending(false)
    }
  }

  /** Ask the server for the task every second and show what it says; stop when the state is final. */
  const follow = (id: number, taskId: string) => {
    let misses = 0
    const stop = () => {
      clearInterval(timer)
      timers.current.delete(timer)
    }
    const timer = setInterval(async () => {
      try {
        const v = await api.task(taskId)
        misses = 0
        patch(id, { state: v.state, progress: v.progress, error: v.error, proposal: v.proposal })
        if (v.final) stop()
      } catch {
        if (++misses >= 5) {
          patch(id, { state: 'failed', error: 'Lost contact with the server' })
          stop()
        }
      }
    }, 1000)
    timers.current.add(timer)
  }

  /** The user answers the proposal; the server tells the Network Agent and the polling shows what follows. */
  const decide = async (run: Run, accept: boolean) => {
    try {
      const v = await api.decide(run.taskId ?? '', accept)
      patch(run.id, { state: v.state, progress: v.progress, error: v.error, proposal: v.proposal })
    } catch (e) {
      patch(run.id, { error: (e as Error).message })
    }
  }

  const openEffect = async (run: Run) => {
    setEffect({ region: run.region })
    try {
      setEffect({ region: run.region, data: await api.effect(run.region, run.taskId ?? '') })
    } catch (e) {
      setEffect({ region: run.region, error: (e as Error).message })
    }
  }

  /** A button does not send: it puts its sentence, in the language of the page, into the box for the user to edit and send. */
  const fill = (sentence: string) => {
    setText(sentence)
    inputRef.current?.focus()
  }

  const onFunction = (f: (typeof FUNCTIONS)[number]) => {
    if (f === FUNCTIONS[0]) fill(defaultIntent(lang))
    else if (f === FUNCTIONS[1]) fill(tr(t("Query today's dynamic electricity price")))
    else fill(tr(t("Query today's Li-ion battery charge/discharge slots")))
  }

  return (
    <Panel title="Energy-saving task dispatch" className={className}>
      <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" role="log" aria-live="polite" aria-label="Conversation">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="rounded-lg border border-[#2f7bff]/30 bg-[#0a2457]/55 p-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-b from-cyan-300 to-blue-500 text-[#04163a]"><Bot className="size-4" aria-hidden="true" /></span>
              <T>Hello! I am the energy-saving agent</T>
            </p>
            <p className="mt-1.5 text-xs text-cyan-100/70"><T>I can help you with:</T></p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs text-cyan-100/80">
              {FUNCTIONS.map((f) => <li key={f}><T>{f}</T></li>)}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            {FUNCTIONS.map((f, k) => {
              const Icon = FN_ICONS[k]
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => onFunction(f)}
                  className="flex min-h-9 flex-1 items-center gap-2 rounded-lg border border-[#2f7bff]/40 bg-[#0d2f6e]/70 px-2.5 py-1 text-left text-xs text-cyan-50 transition-colors hover:bg-[#1a5fd6]/50"
                >
                  <Icon className="size-4 shrink-0 text-sky-400" aria-hidden="true" />
                  <T>{f}</T>
                </button>
              )
            })}
          </div>
        </div>
        {entries.map((e) =>
          e.kind === 'run' ? (
            <RunView key={e.id} run={e} onOpenEffect={openEffect} onAsk={(q) => fill(tr(q))} onRetry={(x) => void send(x)} onDecide={decide} />
          ) : (
            <QueryResult key={e.id} q={e} />
          ),
        )}
      </div>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          void send()
        }}
      >
        <label className="sr-only" htmlFor="intent">Energy-saving intent</label>
        <textarea
          id="intent"
          ref={inputRef}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
              ev.preventDefault()
              void send()
            }
          }}
          rows={2}
          className="min-h-14 flex-1 resize-none rounded-lg border border-[#2f7bff]/40 bg-[#04163a]/70 p-2 text-xs leading-snug focus-visible:outline-2"
        />
        <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Send" title="Send" className="size-10 shrink-0 rounded-lg">
          <Send />
        </Button>
      </form>

      <Dialog open={effect !== null} onOpenChange={(o) => !o && setEffect(null)}>
        <DialogContent className="max-w-2xl border-[#2f7bff]/40 bg-[radial-gradient(120%_90%_at_50%_0%,#12306e_0%,#050b1c_62%)] p-6">
          <div>
            <DialogTitle className="text-2xl font-bold tracking-tight"><T>Energy-saving effect</T></DialogTitle>
            <DialogDescription className="mt-1 inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-0.5 text-xs font-semibold text-cyan-100"><T s="{region} region" v={{ region: effect?.region ?? '' }} /></DialogDescription>
          </div>
          {effect?.error && <p role="alert" className="text-sm text-destructive">{effect.error}</p>}
          {!effect?.data && !effect?.error && <p className="text-sm text-muted-foreground"><T>Loading…</T></p>}
          {effect?.data && <EffectReport data={effect.data} />}
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

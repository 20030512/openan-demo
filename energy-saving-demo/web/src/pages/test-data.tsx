// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { StageChip } from '@/components/dashboard/agent-dialog'
import { PriceBars } from '@/components/dashboard/charts'
import { ErrorNote, Panel } from '@/components/dashboard/panel'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { api, type Dataset, type DatasetSummary, type NewDataset, type Preview, type Profile, type Stage } from '@/lib/api'
import { T, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const PROFILES: { profile: Profile; label: string; hint: string }[] = [
  { profile: 'doc-example', label: t('Design doc example'), hint: t('The 24 hourly prices from the design doc worked example') },
  { profile: 'flat', label: t('Flat'), hint: t('One price all day: no strategy should be produced') },
  { profile: 'two-levels', label: t('Two levels'), hint: t('Cheap morning, expensive afternoon: LOW and PEAK only, never FLAT') },
  { profile: 'single-peak', label: t('Single peak'), hint: t('One smooth price peak around 13:00') },
  { profile: 'double-peak', label: t('Double peak'), hint: t('Morning and evening peaks: exercises the two-discharge plan') },
  { profile: 'last-hour-peak', label: t('Last-hour peak'), hint: t('Price highest at the end of the day: exercises the last-hour exception') },
  { profile: 'random', label: t('Random'), hint: t('Seeded random prices between 0.20 and 1.00') },
]

const field = 'min-h-10 w-full rounded-lg border border-input bg-black/30 px-3 text-sm disabled:opacity-40'
const TINT: Record<Stage, string> = { LOW: 'bg-low/25', FLAT: 'bg-white/5', PEAK: 'bg-peak/25' }

type Note = { text: string; v?: Record<string, string | number>; err?: boolean } | null

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-28 flex-1 flex-col gap-1 font-mono text-[11px] text-muted-foreground', className)}>
      <T>{label}</T>
      {children}
    </label>
  )
}

function Msg({ n }: { n: Note }) {
  if (!n) return null
  return (
    <span role="status" aria-live="polite" className={cn('text-xs', n.err ? 'text-destructive' : 'text-green-400')}>
      <T s={n.text} v={n.v} />
    </span>
  )
}

const snapshot = (d: Dataset) =>
  JSON.stringify({ name: d.name, description: d.description, region: d.region, chargeMin: d.chargeMin, dischargeMin: d.dischargeMin, startOffset: d.startOffset, days: d.days })

const BLANK: NewDataset = {
  name: '',
  description: '',
  profile: 'double-peak',
  days: 2,
  granularity: 0.5,
  chargeMin: 480,
  dischargeMin: 240,
  startOffset: -1,
  seed: 1,
  region: '',
}

function CreateForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [f, setF] = useState<NewDataset>(BLANK)
  const [note, setNote] = useState<Note>(null)
  const set = <K extends keyof NewDataset>(k: K, v: NewDataset[K]) => setF((x) => ({ ...x, [k]: v }))
  const num = (k: keyof NewDataset) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never)
  const hint = PROFILES.find((p) => p.profile === f.profile)?.hint ?? ''
  const create = async () => {
    try {
      const r = await api.createDataset({ ...f, name: f.name.trim() })
      setNote(null)
      setF((x) => ({ ...x, name: '', region: '' }))
      onCreated(r.id)
    } catch (e) {
      setNote({ text: (e as Error).message, err: true })
    }
  }
  return (
    <Panel title="Create a dataset">
      <div className="flex flex-wrap gap-3">
        <Field label="Name" className="basis-full"><input className={field} value={f.name} maxLength={64} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Region name (optional)" className="basis-full"><input className={field} value={f.region ?? ''} maxLength={64} placeholder="REGION-B" onChange={(e) => set('region', e.target.value)} /></Field>
        <p className="basis-full text-xs text-muted-foreground"><T>A task can then be created for this region: one word, letters, digits, _ or -.</T></p>
        <Field label="Description" className="basis-full"><input className={field} value={f.description} maxLength={200} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Price shape" className="basis-full">
          <select className={field} value={f.profile} onChange={(e) => set('profile', e.target.value as Profile)}>
            {PROFILES.map((p) => <option key={p.profile} value={p.profile}>{p.label}</option>)}
          </select>
        </Field>
        <p className="basis-full text-xs text-muted-foreground"><T>{hint}</T></p>
        <Field label="Days (1 to 14)"><input className={field} type="number" min={1} max={14} value={f.days} onChange={num('days')} /></Field>
        <Field label="Price granularity (h)">
          <select className={field} value={f.granularity} onChange={(e) => set('granularity', Number(e.target.value))}>
            <option>0.25</option><option>0.5</option><option>1</option>
          </select>
        </Field>
        <Field label="Charge duration (min)"><input className={field} type="number" min={1} value={f.chargeMin} onChange={num('chargeMin')} /></Field>
        <Field label="Discharge duration (min)"><input className={field} type="number" min={1} value={f.dischargeMin} onChange={num('dischargeMin')} /></Field>
        <Field label="First day, relative to today"><input className={field} type="number" min={-30} max={30} value={f.startOffset} onChange={num('startOffset')} /></Field>
        <Field label="Random seed"><input className={field} type="number" min={0} value={f.seed} onChange={num('seed')} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={create}><Plus /> <T>Create</T></Button>
        <Msg n={note} />
      </div>
    </Panel>
  )
}

export function TestDataPage() {
  const [list, setList] = useState<DatasetSummary[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [draft, setDraft] = useState<Dataset | null>(null)
  const [saved, setSaved] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dayIdx, setDayIdx] = useState(0)
  const [note, setNote] = useState<Note>(null)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async (select?: number) => {
    try {
      const l = await api.datasets()
      setList(l)
      setSel((cur) => select ?? (cur !== null && l.some((x) => x.id === cur) ? cur : (l[0]?.id ?? null)))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (sel === null) return setDraft(null)
    let live = true
    api.dataset(sel).then(
      (d) => {
        if (!live) return
        setDraft(d); setSaved(snapshot(d)); setDayIdx(0); setNote(null)
      },
      (e: Error) => live && setError(e.message),
    )
    return () => { live = false }
  }, [sel])

  // Re-run the algorithm a moment after the last edit, on the unsaved values.
  useEffect(() => {
    if (!draft) return setPreview(null)
    const timer = setTimeout(() => {
      api.previewDataset(draft.id, draft).then(setPreview, (e: Error) => setNote({ text: e.message, err: true }))
    }, 250)
    return () => clearTimeout(timer)
  }, [draft])

  const dirty = draft !== null && snapshot(draft) !== saved
  const change = (p: Partial<Dataset>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const setPrice = (slot: number, v: number) =>
    setDraft((d) => (d ? { ...d, days: d.days.map((day, k) => (k === dayIdx ? day.map((p, i) => (i === slot ? v : p)) : day)) } : d))

  const save = async () => {
    if (!draft) return false
    try {
      await api.updateDataset(draft.id, draft)
      setSaved(snapshot(draft))
      setNote({ text: 'Saved' })
      void loadList(draft.id)
      return true
    } catch (e) {
      setNote({ text: (e as Error).message, err: true })
      return false
    }
  }
  const apply = async () => {
    if (!draft || (dirty && !(await save()))) return
    try {
      const r = await api.applyDataset(draft.id)
      setNote({ text: t('Applied as price batch {batch}: {dates}'), v: { batch: r.batchId, dates: r.dates.join(', ') } })
    } catch (e) {
      setNote({ text: (e as Error).message, err: true })
    }
  }
  const duplicate = async () => {
    if (!draft) return
    try { await loadList((await api.duplicateDataset(draft.id)).id) } catch (e) { setNote({ text: (e as Error).message, err: true }) }
  }
  const remove = async () => {
    if (!draft) return
    try { await api.deleteDataset(draft.id); setSel(null); await loadList() } catch (e) { setNote({ text: (e as Error).message, err: true }) }
  }
  const reset = async () => {
    try { await api.resetDatasets(); setSel(null); await loadList() } catch (e) { setError((e as Error).message) }
  }

  const day = preview?.days[dayIdx]
  const counts = useMemo(() => {
    const c: Record<Stage, number> = { LOW: 0, FLAT: 0, PEAK: 0 }
    day?.stages.forEach((s) => c[s]++)
    return c
  }, [day])

  return (
    <div className="grid gap-3 lg:h-full lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto">
        <Panel
          title="Datasets"
          aside={<ConfirmButton label="Restore built-in" confirm="Delete all and restore?" icon={<RotateCcw />} onConfirm={reset} />}
        >
          {error && <ErrorNote message={error} onRetry={() => void loadList()} />}
          <ul className="space-y-1.5" aria-label="Datasets">
            {list.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSel(d.id)}
                  aria-current={sel === d.id ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-2xl border p-3 text-left transition-colors',
                    sel === d.id ? 'border-primary/70 bg-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/10',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold"><T>{d.name}</T></span>
                    {d.builtIn && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]"><T>built-in</T></span>}
                  </div>
                  {d.region && <div className="mt-0.5 font-mono text-[11px] text-cyan-200"><T s="Region: {region}" v={{ region: d.region }} /></div>}
                  {d.description && <div className="mt-0.5 text-xs text-muted-foreground"><T>{d.description}</T></div>}
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {d.dayCount}d × {d.slotsPerDay} · {d.chargeMin}/{d.dischargeMin} min · {d.granularity} h
                  </div>
                </button>
              </li>
            ))}
            {list.length === 0 && !error && <li className="text-xs text-muted-foreground"><T>No datasets yet.</T></li>}
          </ul>
        </Panel>
        <CreateForm onCreated={(id) => void loadList(id)} />
      </div>

      <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto">
        {!draft && <Panel title="Dataset"><p className="text-sm text-muted-foreground"><T>Select or create a dataset.</T></p></Panel>}
        {draft && (
          <>
            <Panel
              title="Dataset"
              aside={dirty ? <span className="rounded bg-yellow-400/20 px-2 py-0.5 text-[11px] text-yellow-300"><T>unsaved changes</T></span> : undefined}
            >
              <div className="flex flex-wrap gap-3">
                <Field label="Name" className="basis-full sm:basis-[calc(50%-0.375rem)]"><input className={field} value={draft.name} maxLength={64} onChange={(e) => change({ name: e.target.value })} /></Field>
                <Field label="Description" className="basis-full sm:basis-[calc(50%-0.375rem)]"><input className={field} value={draft.description} maxLength={200} onChange={(e) => change({ description: e.target.value })} /></Field>
                <Field label="Region name (optional)" className="basis-full sm:basis-[calc(50%-0.375rem)]"><input className={field} value={draft.region} maxLength={64} placeholder="REGION-A" onChange={(e) => change({ region: e.target.value })} /></Field>
                <Field label="Charge duration (min)"><input className={field} type="number" min={1} value={draft.chargeMin} onChange={(e) => change({ chargeMin: Number(e.target.value) })} /></Field>
                <Field label="Discharge duration (min)"><input className={field} type="number" min={1} value={draft.dischargeMin} onChange={(e) => change({ dischargeMin: Number(e.target.value) })} /></Field>
                <Field label="First day, relative to today"><input className={field} type="number" min={-30} max={30} value={draft.startOffset} onChange={(e) => change({ startOffset: Number(e.target.value) })} /></Field>
                <Field label="Price granularity (h)"><input className={field} value={draft.granularity} disabled /></Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={!dirty}><Save /> <T>Save</T></Button>
                <Button variant="secondary" onClick={apply}><Play /> <T>Apply as latest price batch</T></Button>
                <Button variant="outline" onClick={duplicate}><Copy /> <T>Duplicate</T></Button>
                <ConfirmButton label="Delete" confirm="Click again to delete" icon={<Trash2 />} onConfirm={remove} />
                <Msg n={note} />
              </div>
              {note && !note.err && note.text.startsWith('Applied') && (
                <p className="mt-2 text-xs text-muted-foreground">
                  <T>Now open the dashboard and ask the agent for today's or yesterday's prices.</T>{' '}
                  <a className="text-primary underline" href="#/"><T>Open dashboard</T></a>
                </p>
              )}
            </Panel>

            <Panel title="Prices and strategy preview">
              <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Days">
                {draft.days.map((_, k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={dayIdx === k}
                    onClick={() => setDayIdx(k)}
                    className={cn('min-h-9 rounded-full border px-3 font-mono text-xs', dayIdx === k ? 'border-primary bg-primary text-primary-foreground' : 'border-white/12 hover:bg-white/10')}
                  >
                    {preview?.days[k]?.date ?? `#${k + 1}`}
                  </button>
                ))}
              </div>
              {day && (
                <>
                  <PriceBars prices={day.prices} stages={day.stages} desc={`Prices for ${day.date}, coloured by stage`} />
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <StageChip s="LOW" /> <span className="font-mono">{counts.LOW}</span>
                    <StageChip s="PEAK" /> <span className="font-mono">{counts.PEAK}</span>
                    <StageChip s="FLAT" /> <span className="font-mono">{counts.FLAT}</span>
                    <span className="text-muted-foreground"><T>slots</T></span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6" role="group" aria-label="Prices">
                    {day.prices.map((p, i) => (
                      <label key={`${dayIdx}-${i}-${p}`} className={cn('rounded-lg p-1 font-mono text-[10px] text-muted-foreground', TINT[day.stages[i]])}>
                        {slotStart(i, draft.granularity)}
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          defaultValue={p}
                          aria-label={`Price at ${slotStart(i, draft.granularity)}`}
                          className="mt-0.5 block min-h-8 w-full rounded border border-white/10 bg-black/30 px-1.5 text-xs text-foreground"
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (e.target.value !== '' && Number.isFinite(v) && v >= 0 && v !== p) setPrice(i, v)
                            else e.target.value = String(p)
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Strategy this dataset produces">
              <div className="max-h-72 overflow-auto rounded-xl border border-white/10">
                <table className="w-full text-xs">
                  <caption className="sr-only">Charge/discharge strategy</caption>
                  <thead className="sticky top-0 bg-[#0e1d3a]">
                    <tr className="text-left font-mono text-muted-foreground">
                      <th className="p-2"><T>Date</T></th><th className="p-2"><T>Time</T></th><th className="p-2"><T>Stage</T></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview?.strategies.map((s, i) => (
                      <tr key={i} className="border-t border-white/8">
                        <td className="p-2 font-mono">{s.date}</td>
                        <td className="p-2 font-mono">{s.startTime}–{s.endTime}</td>
                        <td className="p-2"><StageChip s={s.stage} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

function slotStart(i: number, g: number) {
  const m = Math.round(i * g * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

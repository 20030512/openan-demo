// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { tr, trMsg } from '../i18n';
import { API } from '../services/base';
import DayStrategyChart, { STAGE_LABEL } from '../components/DayStrategyChart';
import strategyConfigApi, { type ExportTemplate } from '../services/strategy-config-api';
import { getTodayDateString } from '../date';
import type { ChargeDischargePlanItem, NetworkElement, PriceDataItem, SystemConfig } from '../types/energy-saving';

const DAY_SHEETS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const MONTH_SHEETS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Price slot lengths the backend accepts (hours). */
const GRANULARITIES: Array<{ hours: number; label: string; rows: number }> = [
  { hours: 0.25, label: '15 min', rows: 96 },
  { hours: 0.5, label: '30 min', rows: 48 },
  { hours: 1, label: '60 min', rows: 24 },
];

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The weekly template is the export (agreed rule): a monthly sheet cannot
// tell the days of one month apart.
const EXPORT_TEMPLATES: Array<{ id: ExportTemplate; title: string; note: string }> = [
  { id: 'day', title: 'By weekday', note: '错峰调整按天配置 · one sheet per weekday (7 sheets)' },
];

function emptySheets(template: 'day' | 'month', dates: string[]): string[] {
  const sheets = template === 'day' ? DAY_SHEETS : MONTH_SHEETS;
  return sheets.filter((_, i) =>
    template === 'day' ? !dates.some((d) => parseDate(d).getDay() === i) : !dates.some((d) => parseDate(d).getMonth() === i)
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: revoking right after click() can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const hoursLabel = (minutes: number) => (Number.isFinite(minutes) && minutes > 0 ? `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} h` : '—');
const segHours = (s: { startTime: string; endTime: string }) =>
  (Number(s.endTime.slice(0, 2)) * 60 + Number(s.endTime.slice(3)) - Number(s.startTime.slice(0, 2)) * 60 - Number(s.startTime.slice(3))) / 60;

type Toast = { id: number; kind: 'ok' | 'bad'; text: string };

export default function StrategyConfigPage(): JSX.Element {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [standby, setStandby] = useState('');
  const [discharge, setDischarge] = useState('');

  const [nes, setNes] = useState<NetworkElement[]>([]);
  const [neName, setNeName] = useState('');
  const [neMode, setNeMode] = useState<'Fixed' | 'Dynamic'>('Fixed');
  const [neThreshold, setNeThreshold] = useState('80');
  const [neTarget, setNeTarget] = useState('120');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const [prices, setPrices] = useState<PriceDataItem[]>([]);
  const [strategies, setStrategies] = useState<ChargeDischargePlanItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<'' | 'import' | 'regenerate' | 'durations' | 'granularity' | 'ne'>('');
  const fileInput = useRef<HTMLInputElement>(null);

  const [selectedDate, setSelectedDate] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState('');

  const [exportOpen, setExportOpen] = useState(false);
  const [exportTemplate, setExportTemplate] = useState<ExportTemplate>('day');
  const [applyDateToEmpty, setApplyDateToEmpty] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  function toast(kind: Toast['kind'], text: string): void {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 9000 : 6000);
  }

  // ─── data ───
  const priceDates = useMemo(() => [...new Set(prices.map((p) => p.priceDate))].sort(), [prices]);
  const strategyDates = useMemo(() => [...new Set(strategies.map((s) => s.strategyDate))].sort(), [strategies]);
  const batchId = prices[0]?.batchId ?? null;
  const values = prices.map((p) => p.priceValue);
  const valley = values.length ? Math.min(...values) : null;
  const peak = values.length ? Math.max(...values) : null;
  const dayPrices = useMemo(() => prices.filter((p) => p.priceDate === selectedDate), [prices, selectedDate]);
  // The strategy is stored per price slot; merge equal neighbours for the chart and the cards.
  const daySegments = useMemo(() => {
    const merged: ChargeDischargePlanItem[] = [];
    for (const s of strategies.filter((x) => x.strategyDate === selectedDate)) {
      const last = merged[merged.length - 1];
      if (last && last.stage === s.stage && last.endTime === s.startTime) merged[merged.length - 1] = { ...last, endTime: s.endTime };
      else merged.push({ ...s });
    }
    return merged;
  }, [strategies, selectedDate]);
  // A single-tier day is stored as one 00:00–24:00 FLAT segment: no charging or discharging.
  const notExecuted = priceDates.filter((d) => !strategies.some((s) => s.strategyDate === d && s.stage !== 'FLAT'));
  const currentEmpty = useMemo(
    () => (exportOpen && exportTemplate !== 'tou' ? emptySheets(exportTemplate, strategyDates) : []),
    [exportOpen, exportTemplate, strategyDates]
  );

  useEffect(() => {
    if (priceDates.length && !priceDates.includes(selectedDate)) {
      const today = getTodayDateString();
      setSelectedDate(priceDates.includes(today) ? today : priceDates[0]);
    }
  }, [priceDates, selectedDate]);

  async function loadConfig(): Promise<void> {
    const cfg = await strategyConfigApi.getConfig();
    setConfig(cfg);
    setStandby(String(cfg.standby_duration));
    setDischarge(String(cfg.discharge_duration));
  }
  const loadNes = async () => setNes(await strategyConfigApi.listNetworkElements());
  const loadPrices = async () => setPrices(await strategyConfigApi.listPrices());
  const loadStrategies = async () => setStrategies(await strategyConfigApi.listStrategies());

  useEffect(() => {
    Promise.all([loadConfig(), loadNes(), loadPrices(), loadStrategies()])
      .then(() => setLoadError(''))
      .catch((e: Error) => setLoadError(tr('Could not load the data from the backend ({msg}). Is the server running? Reload the page.', { msg: e.message })));
  }, []);

  // ─── actions ───
  async function run(kind: typeof busy, action: () => Promise<void>): Promise<void> {
    setBusy(kind);
    try {
      await action();
    } catch (e) {
      toast('bad', (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const saveDurations = () =>
    run('durations', async () => {
      await strategyConfigApi.saveConfig({ standby_duration: Number(standby), discharge_duration: Number(discharge) });
      await loadConfig();
      toast('ok', prices.length ? tr('Schedule saved — regenerate the strategy to apply it.') : tr('Schedule saved.'));
    });

  const saveGranularity = (hours: number) =>
    run('granularity', async () => {
      await strategyConfigApi.saveConfig({ price_granularity: hours });
      await loadConfig();
      const g = GRANULARITIES.find((x) => x.hours === hours);
      toast('ok', tr('Price slots set to {label} ({rows} rows per day). The sample file follows this setting.', { label: tr(g?.label ?? ''), rows: g?.rows ?? 0 }));
    });

  const importFile = () =>
    run('import', async () => {
      if (!file) return;
      const result = await strategyConfigApi.importPrices(file);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      // The import may change the slot length to the one found in the file.
      await Promise.all([loadConfig(), loadPrices(), loadStrategies()]);
      toast('ok', tr('{message} — {count} price rows, batch {batch}.', { message: trMsg(result.message), count: result.count, batch: result.batchId }));
    });

  const regenerate = () =>
    run('regenerate', async () => {
      const result = await strategyConfigApi.generateStrategy();
      await loadStrategies();
      const skipped = result.notExecuted.length ? tr(' No charging or discharging on {dates}.', { dates: result.notExecuted.join(', ') }) : '';
      toast('ok', `${tr('Strategy regenerated from batch {batch}.', { batch: result.batchId })}${skipped} ${result.warnings?.join(' ') ?? ''}`.trim());
    });

  const addNe = () =>
    run('ne', async () => {
      await strategyConfigApi.addNetworkElement({
        name: neName,
        generationMode: neMode,
        dischargeThreshold: neMode === 'Fixed' ? Number(neThreshold) : undefined,
        targetDuration: neMode === 'Dynamic' ? Number(neTarget) : undefined,
      });
      toast('ok', tr('Network element {name} added.', { name: neName }));
      setNeName('');
      await loadNes();
    });

  const deleteNe = (ne: NetworkElement) =>
    run('ne', async () => {
      await strategyConfigApi.deleteNetworkElement(ne.id);
      setConfirmDelete(null);
      toast('ok', tr('Network element {name} deleted.', { name: ne.name }));
      await loadNes();
    });

  async function doExport(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { filename, blob, summary } = await strategyConfigApi.exportDeployment(exportTemplate, applyDateToEmpty || undefined);
      downloadBlob(blob, filename);
      setExportOpen(false);
      const empty = summary.empty.length ? tr(' Empty sheets: {list}.', { list: summary.empty.join(', ') }) : '';
      toast('ok', `${tr('Downloaded {file} — {n} sheet(s) filled.', { file: filename, n: summary.filled.length })}${empty}`);
    } catch (e) {
      // Shown inside the dialog: a toast would be hidden behind it.
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }

  const granularity = config?.price_granularity;
  const granularityInfo = GRANULARITIES.find((g) => g.hours === granularity);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">{tr('Li-ion battery charge/discharge slot plan')}</h2>
          <p className="page-sub">
            {tr('Turn tiered electricity prices into a battery charge/discharge plan and export it to Deployment.')}
          </p>
        </div>
        <div className="head-actions">
          <a className="btn ghost" href={strategyConfigApi.exportCsvUrl()}>CSV</a>
          <button
            className="btn primary"
            onClick={() => {
              setExportError('');
              setExportOpen(true);
            }}
            disabled={strategies.length === 0}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 14v2h12v-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {tr('Export to Deployment')}
          </button>
        </div>
      </div>

      {loadError && <div className="banner bad">{loadError}</div>}

      <div className="layout">
        <section className="kpis" aria-label={tr('Summary')}>
          <div className="kpi">
            <span className="kpi-label">{tr('Price batch')}</span>
            <span className="kpi-value">{batchId ? `#${batchId}` : '—'}</span>
            <span className="kpi-note">
              {priceDates.length ? `${priceDates[0]} → ${priceDates[priceDates.length - 1]}` : tr('No prices imported yet')}
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{tr('Days planned')}</span>
            <span className="kpi-value">
              {priceDates.length - notExecuted.length}
              <small>/ {priceDates.length}</small>
            </span>
            <span className="kpi-note">{notExecuted.length ? tr('{n} day(s) single tier — no shifting', { n: notExecuted.length }) : tr('Every day has a plan')}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{tr('Valley · peak price')}</span>
            <span className="kpi-value mono">
              {valley !== null && peak !== null ? `${valley.toFixed(2)} · ${peak.toFixed(2)}` : '—'}
            </span>
            <span className="kpi-note">{tr('CNY/kWh, latest batch')}</span>
          </div>
          <div className="kpi accent">
            <span className="kpi-label">{tr('Peak–valley spread')}</span>
            <span className="kpi-value mono">{valley !== null && peak !== null ? (peak - valley).toFixed(2) : '—'}</span>
            <span className="kpi-note">{tr('CNY per kWh shifted')}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{tr('Battery schedule')}</span>
            <span className="kpi-value mono">
              {config ? `${hoursLabel(config.standby_duration)} · ${hoursLabel(config.discharge_duration)}` : '—'}
            </span>
            <span className="kpi-note">{tr('charge · discharge per day')}</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{tr('Network elements')}</span>
            <span className="kpi-value mono">{nes.length}</span>
            <span className="kpi-note">
              {nes.length
                ? tr('{fixed} fixed · {dynamic} dynamic', { fixed: nes.filter((ne) => ne.generationMode === 'Fixed').length, dynamic: nes.filter((ne) => ne.generationMode === 'Dynamic').length })
                : tr('None added yet')}
            </span>
          </div>
        </section>
        {/* ─── day plan ─── */}
        <section className="panel plan-panel">
          <div className="panel-head">
            <div>
              <h2>{tr('Daily plan')}</h2>
              <p className="panel-sub">{tr('Price curve with the charge and discharge windows the strategy chose.')}</p>
            </div>
            <button className="btn ghost" onClick={regenerate} disabled={prices.length === 0 || busy === 'regenerate'}>
              {busy === 'regenerate' ? <span className="spinner" aria-hidden="true" /> : (
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M15.5 8A6 6 0 0 0 4.6 6.3M4.5 12a6 6 0 0 0 10.9 1.7M4 3v3.5h3.5M16 17v-3.5h-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
              {tr('Regenerate')}
            </button>
          </div>

          {priceDates.length === 0 ? (
            <div className="empty-hero">
              <div className="empty-art" aria-hidden="true">
                <svg viewBox="0 0 120 60" width="160" height="80"><path d="M0 45 H20 V30 H45 V12 H70 V30 H95 V40 H120" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
              </div>
              <h3>{tr('No price data yet')}</h3>
              <p>{tr('Download the sample price file, adjust the prices and import it on the right — the plan appears here.')}</p>
              <a className="btn primary" href={`${API}/price/sample.xlsx`}>{tr('Download sample price file')}</a>
            </div>
          ) : (
            <>
              <div className="date-chips" role="tablist" aria-label={tr('Days')}>
                {priceDates.map((d) => {
                  const planned = !notExecuted.includes(d);
                  return (
                    <button
                      key={d}
                      role="tab"
                      aria-selected={d === selectedDate}
                      className={`date-chip${d === selectedDate ? ' active' : ''}${planned ? '' : ' unplanned'}`}
                      onClick={() => setSelectedDate(d)}
                      title={planned ? undefined : tr('Single price tier — no charging or discharging')}
                    >
                      <span className="dc-day">{tr(WEEKDAY[parseDate(d).getDay()])}</span>
                      <span className="dc-date">{d.slice(5)}</span>
                      {d === getTodayDateString() && <span className="dc-today">{tr('today')}</span>}
                    </button>
                  );
                })}
              </div>

              <DayStrategyChart prices={dayPrices} segments={daySegments} />

              <div className="segments">
                {daySegments.length === 0 ? (
                  <div className="muted-note">{tr('Single price tier on {day}: no charging or discharging for this day.', { day: selectedDate })}</div>
                ) : (
                  daySegments.map((s) => (
                    <div key={s.id} className={`segment seg-${s.stage}`}>
                      <span className="seg-dot" aria-hidden="true" />
                      <span className="seg-time mono">
                        {s.startTime}–{s.endTime}
                      </span>
                      <span className="seg-stage">{STAGE_LABEL[s.stage]}</span>
                      <span className="seg-code">{s.stage}</span>
                      <span className="seg-hours mono">{segHours(s)} h</span>
                    </div>
                  ))
                )}
              </div>

              <details className="price-details">
                <summary>{tr('Price slots of {day} ({n})', { day: selectedDate, n: dayPrices.length })}</summary>
                <div className="price-grid">
                  {dayPrices.map((p) => (
                    <div key={p.id} className="price-cell">
                      <span className="mono">{p.timeSlot}</span>
                      <b className="mono">{p.priceValue.toFixed(2)}</b>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </section>

        {/* ─── setup column ─── */}
        <aside className="setup">
          <section className="panel">
            <div className="step-head">
              <span className="step-no">1</span>
              <div>
                <h2>{tr('Battery schedule')}</h2>
                <p className="panel-sub">{tr('Daily charge and discharge time.')}</p>
              </div>
            </div>
            <div className="two-fields">
              <label className="field">
                <span>{tr('Charge (standby)')}</span>
                <div className="input-unit">
                  <input id="standby" type="number" min={1} value={standby} onChange={(e) => setStandby(e.target.value)} />
                  <em>{tr('min')}</em>
                </div>
                <small>{hoursLabel(Number(standby))}</small>
              </label>
              <label className="field">
                <span>{tr('Discharge')}</span>
                <div className="input-unit">
                  <input id="discharge" type="number" min={1} value={discharge} onChange={(e) => setDischarge(e.target.value)} />
                  <em>{tr('min')}</em>
                </div>
                <small>{hoursLabel(Number(discharge))}</small>
              </label>
            </div>
            <button className="btn primary block" onClick={saveDurations} disabled={busy === 'durations'}>
              {busy === 'durations' ? tr('Saving…') : tr('Save schedule')}
            </button>
          </section>

          <section className="panel">
            <div className="step-head">
              <span className="step-no">2</span>
              <div>
                <h2>{tr('Price data')}</h2>
                <p className="panel-sub">{tr('Slot length, then import the price file.')}</p>
              </div>
            </div>
            <div className="field">
              <span>{tr('Price slot length')}</span>
              <div className="segmented" role="radiogroup" aria-label={tr('Price slot length')}>
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.hours}
                    role="radio"
                    aria-checked={granularity === g.hours}
                    className={granularity === g.hours ? 'on' : ''}
                    onClick={() => granularity !== g.hours && saveGranularity(g.hours)}
                    disabled={busy === 'granularity'}
                  >
                    {tr(g.label)}
                  </button>
                ))}
              </div>
              <small>{granularityInfo ? tr('{n} price rows per day', { n: granularityInfo.rows }) : tr('Choose a slot length')}</small>
            </div>

            <label
              className={`dropzone${dragOver ? ' over' : ''}${file ? ' has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {file ? (
                <span className="dz-file">{file.name}</span>
              ) : (
                <span>
                  <b>{tr('Drop the price file here')}</b>{tr(' or click to choose')}
                  <br />
                  <small>.xlsx · .xls · .csv</small>
                </span>
              )}
            </label>
            <div className="row-actions">
              <a className="btn ghost" href={`${API}/price/sample.xlsx`} title={tr('Sample in the import format, at the slot length above')}>
                {tr('Sample file')}
              </a>
              <button className="btn primary" onClick={importFile} disabled={!file || busy === 'import'}>
                {busy === 'import' ? <><span className="spinner on-accent" aria-hidden="true" />{tr('Importing…')}</> : tr('Import & generate')}
              </button>
            </div>
          </section>

          <section className="panel ne-panel">
            <div className="step-head">
              <span className="step-no">3</span>
              <div>
                <h2>{tr('Network elements')}</h2>
                <p className="panel-sub">{tr('Written to the 网元列表 sheet of the export.')}</p>
              </div>
            </div>
            <div className="ne-form">
              <input
                id="ne-name"
                placeholder={tr('NE name, e.g. ZZ-Site-001')}
                value={neName}
                onChange={(e) => setNeName(e.target.value)}
              />
              <div className="segmented small" role="radiogroup" aria-label={tr('Save strategy mode')}>
                {(['Fixed', 'Dynamic'] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={neMode === m} className={neMode === m ? 'on' : ''} onClick={() => setNeMode(m)}>
                    {tr(m)}
                  </button>
                ))}
              </div>
              {neMode === 'Fixed' ? (
                <label className="inline-field">
                  {tr('Stop discharging below')}
                  <div className="input-unit">
                    <input type="number" min={50} max={100} value={neThreshold} onChange={(e) => setNeThreshold(e.target.value)} />
                    <em>%</em>
                  </div>
                </label>
              ) : (
                <label className="inline-field">
                  {tr('Keep backup for')}
                  <div className="input-unit">
                    <input type="number" min={30} max={600} value={neTarget} onChange={(e) => setNeTarget(e.target.value)} />
                    <em>{tr('min')}</em>
                  </div>
                </label>
              )}
              <button className="btn primary block" onClick={addNe} disabled={!neName.trim() || busy === 'ne'}>
                {tr('Add network element')}
              </button>
            </div>
            <ul className="ne-list">
              {nes.length === 0 && <li className="muted-note">{tr('No network elements yet.')}</li>}
              {nes.map((ne) => (
                <li key={ne.id} className="ne-item">
                  <div className="ne-main">
                    <span className="ne-name">{ne.name}</span>
                    <span className={`mode-badge ${ne.generationMode}`}>{tr(ne.generationMode)}</span>
                  </div>
                  <span className="ne-value mono">
                    {ne.generationMode === 'Fixed' ? tr('stop < {n}%', { n: ne.dischargeThreshold ?? '—' }) : tr('backup {n} min', { n: ne.targetDuration ?? '—' })}
                  </span>
                  {confirmDelete === ne.id ? (
                    <span className="confirm">
                      <button className="link danger" onClick={() => deleteNe(ne)}>{tr('Delete')}</button>
                      <button className="link" onClick={() => setConfirmDelete(null)}>{tr('Keep')}</button>
                    </span>
                  ) : (
                    <button className="icon-btn" onClick={() => setConfirmDelete(ne.id)} aria-label={tr('Delete {name}', { name: ne.name })}>
                      <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m-6 0 .7 10h6.6L14 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {exportOpen && (
        <div className="overlay" onClick={() => !exporting && setExportOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="export-title">{tr('Export to Deployment')}</h3>
            <p className="panel-sub">{tr('Writes the latest strategy batch and the network elements into an Excel workbook.')}</p>
            <div className="template-pick three">
              {EXPORT_TEMPLATES.map((t) => (
                <button key={t.id} className={`template-card${exportTemplate === t.id ? ' on' : ''}`} onClick={() => setExportTemplate(t.id)}>
                  <b>{tr(t.title)}</b>
                  <span>{tr(t.note)}</span>
                </button>
              ))}
            </div>
            {exportTemplate === 'tou' ? (
              <div className="sheet-grid">
                {['Cover', 'NEList', ...[...new Set(strategyDates.map((d) => d.slice(0, 7)))]].map((s) => (
                  <span key={s} className="sheet filled">{s}</span>
                ))}
              </div>
            ) : (
            <>
            <div className="sheet-grid">
              {(exportTemplate === 'day' ? DAY_SHEETS : MONTH_SHEETS).map((s) => (
                <span key={s} className={`sheet ${currentEmpty.includes(s) && !applyDateToEmpty ? 'empty' : 'filled'}`}>{s}</span>
              ))}
            </div>
            <label className="field">
              <span>{tr('Fill the empty sheets with the plan of')}</span>
              <select id="apply-date" value={applyDateToEmpty} onChange={(e) => setApplyDateToEmpty(e.target.value)}>
                <option value="">{tr('— leave them empty —')}</option>
                {strategyDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            </>
            )}
            {exportError && <div className="banner bad">{exportError}</div>}
            <div className="dialog-actions">
              <button className="btn ghost" onClick={() => setExportOpen(false)} disabled={exporting}>
                {tr('Cancel')}
              </button>
              <button className="btn primary" onClick={doExport} disabled={exporting}>
                {exporting ? <><span className="spinner on-accent" aria-hidden="true" />{tr('Preparing…')}</> : tr('Download Excel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-icon" aria-hidden="true">{t.kind === 'ok' ? '✓' : '!'}</span>
            <span>{t.text}</span>
            <button className="toast-x" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label={tr('Dismiss')}>×</button>
          </div>
        ))}
      </div>
    </main>
  );
}

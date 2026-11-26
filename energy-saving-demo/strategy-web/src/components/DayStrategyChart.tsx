// Copyright (c) 2026 Huawei Technologies Co., Ltd.
// All Rights Reserved.
//
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { tr } from '../i18n';

/**
 * One day of the strategy: the electricity price as a step line over 00:00–24:00,
 * with the charge (LOW) and discharge (PEAK) windows shaded behind it and a stage
 * strip underneath. Hover shows the time, price and stage. Pure SVG, theme tokens.
 */

export interface ChartPrice {
  timeSlot: string;
  priceValue: number;
}
export interface ChartSegment {
  startTime: string;
  endTime: string;
  stage: 'LOW' | 'FLAT' | 'PEAK';
}

const W = 760;
const H = 230;
const M = { left: 46, right: 14, top: 16, bottom: 26 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const x = (min: number) => M.left + (min / 1440) * PW;

export const STAGE_LABEL: Record<ChartSegment['stage'], string> = {
  LOW: tr('Charge'),
  PEAK: tr('Discharge'),
  FLAT: tr('Idle'),
};

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? raw;
  // First tick at or below lo, last tick at or above hi, so every price stays inside the plot.
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  const ticks: number[] = [];
  for (let i = first; i <= Math.max(last, first + 1); i++) ticks.push(Math.round(i * step * 1e6) / 1e6);
  return ticks;
}

export default function DayStrategyChart({
  prices,
  segments,
  compact = false,
}: {
  prices: ChartPrice[];
  segments: ChartSegment[];
  compact?: boolean;
}): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);

  const slots = useMemo(
    () =>
      prices
        .map((p) => {
          const [a, b] = p.timeSlot.split('-');
          return { start: toMin(a), end: toMin(b), price: p.priceValue };
        })
        .sort((a, b) => a.start - b.start),
    [prices]
  );
  const segs = useMemo(
    () => segments.map((s) => ({ start: toMin(s.startTime), end: toMin(s.endTime), stage: s.stage })),
    [segments]
  );

  if (slots.length === 0) {
    return <div className="chart-empty">{tr('No price data for this day')}</div>;
  }

  const values = slots.map((s) => s.price);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || hi || 1) * 0.18;
  const ticks = niceTicks(Math.max(0, lo - pad), hi + pad);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const y = (v: number) => M.top + PH - ((v - yMin) / (yMax - yMin || 1)) * PH;

  let line = '';
  slots.forEach((s, i) => {
    line += `${i === 0 ? 'M' : 'L'}${x(s.start).toFixed(1)},${y(s.price).toFixed(1)} H${x(s.end).toFixed(1)} `;
  });
  const area = `${line} V${M.top + PH} H${x(slots[0].start).toFixed(1)} Z`;

  const hovered = hover === null ? null : slots.find((s) => hover >= s.start && hover < s.end) ?? null;
  const hoveredStage = hover === null ? null : segs.find((s) => hover >= s.start && hover < s.end)?.stage ?? 'FLAT';

  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const min = Math.round(((px - M.left) / PW) * 1440);
    setHover(min >= 0 && min < 1440 ? min : null);
  }

  return (
    <div className={`day-chart${compact ? ' compact' : ''}`}>
      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Electricity price and charge/discharge windows over the day"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {segs
            .filter((s) => s.stage !== 'FLAT')
            .map((s, i) => (
              <rect
                key={i}
                className={`band band-${s.stage}`}
                x={x(s.start)}
                y={M.top}
                width={x(s.end) - x(s.start)}
                height={PH}
              />
            ))}
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={M.left - 8} y={y(t) + 4} textAnchor="end">
                {t.toFixed(2)}
              </text>
            </g>
          ))}
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <text key={h} className="axis-label" x={x(h * 60)} y={H - 6} textAnchor="middle">
              {String(h).padStart(2, '0')}:00
            </text>
          ))}
          <path className="price-area" d={area} />
          <path className="price-line" d={line} />
          {hover !== null && (
            <line className="hover-line" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PH} />
          )}
        </svg>
        {hovered && hover !== null && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <span className="tip-time">
              {fmt(hovered.start)}–{fmt(hovered.end)}
            </span>
            <span className="tip-price">{tr('{price} CNY/kWh', { price: hovered.price.toFixed(2) })}</span>
            <span className={`tip-stage stage-${hoveredStage}`}>{STAGE_LABEL[hoveredStage ?? 'FLAT']}</span>
          </div>
        )}
      </div>
      <div className="stage-strip" aria-hidden="true">
        {(segs.length ? segs : [{ start: 0, end: 1440, stage: 'FLAT' as const }]).map((s, i) => (
          <span
            key={i}
            className={`strip-seg strip-${s.stage}`}
            style={{ width: `${((s.end - s.start) / 1440) * 100}%` }}
            title={`${fmt(s.start)}–${fmt(s.end)} ${STAGE_LABEL[s.stage]}`}
          >
            {!compact && s.end - s.start >= 120 ? STAGE_LABEL[s.stage] : ''}
          </span>
        ))}
      </div>
      <div className="chart-legend">
        <span><i className="lg lg-price" />{tr('Price (CNY/kWh)')}</span>
        <span><i className="lg lg-LOW" />{tr('Charge · LOW')}</span>
        <span><i className="lg lg-PEAK" />{tr('Discharge · PEAK')}</span>
        <span><i className="lg lg-FLAT" />{tr('Idle · FLAT')}</span>
      </div>
    </div>
  );
}

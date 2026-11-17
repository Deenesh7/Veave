import React, { useState } from 'react';
import { fmt } from './ui';

const W = 640;
const niceMax = (value) => { if (value <= 0) return 1; const pow = 10 ** Math.floor(Math.log10(value)); const n = value / pow; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow; };

/** Line/area chart with a hover read-out. `series` = [{ key, label, color }]. */
export function LineChart({ data = [], xKey = 'date', series, height = 200, format = fmt }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const max = niceMax(Math.max(0, ...data.flatMap((row) => series.map((s) => row[s.key] || 0))));
  const x = (index) => pad.l + (data.length <= 1 ? 0 : (index / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (value) => pad.t + (1 - value / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.5, 1].map((t) => max * t);
  if (!data.length) return <p className="py-10 text-center text-xs text-[#7A7366]">No data in this period.</p>;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Line chart" onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); const px = ((event.clientX - box.left) / box.width) * W; setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1))))); }}>
        {ticks.map((tick) => <g key={tick}><line x1={pad.l} x2={W - pad.r} y1={y(tick)} y2={y(tick)} stroke="#EFEBE1" /><text x={pad.l - 6} y={y(tick) + 3} textAnchor="end" fontSize="10" fill="#7A7366">{format(Math.round(tick))}</text></g>)}
        {series.map((s) => {
          const points = data.map((row, i) => `${x(i)},${y(row[s.key] || 0)}`).join(' ');
          return (
            <g key={s.key}>
              <polygon points={`${x(0)},${y(0)} ${points} ${x(data.length - 1)},${y(0)}`} fill={s.color} opacity="0.08" />
              <polyline points={points} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            </g>
          );
        })}
        {data.map((row, i) => (i % labelEvery === 0 ? <text key={row[xKey]} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#7A7366">{String(row[xKey]).slice(5)}</text> : null))}
        {hover !== null ? <g><line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#B9B2A2" strokeDasharray="3 3" />{series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key] || 0)} r="3.5" fill={s.color} />)}</g> : null}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute right-2 top-1 rounded-lg border border-[#E2DCCF] bg-white px-2.5 py-1.5 text-xs shadow">
          <p className="font-medium text-[#2B2823]">{data[hover][xKey]}</p>
          {series.map((s) => <p key={s.key} className="text-[#5B554A]"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}: {format(data[hover][s.key] || 0)}</p>)}
        </div>
      ) : null}
      {series.length > 1 ? <div className="mt-1 flex flex-wrap gap-3 text-xs text-[#5B554A]">{series.map((s) => <span key={s.key}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}</div> : null}
    </div>
  );
}

/** Vertical bars. */
export function BarChart({ data = [], xKey, yKey, color = '#5E7B5F', height = 200, format = fmt }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const max = niceMax(Math.max(0, ...data.map((row) => row[yKey] || 0)));
  if (!data.length) return <p className="py-10 text-center text-xs text-[#7A7366]">No data in this period.</p>;
  const slot = (W - pad.l - pad.r) / data.length;
  const barW = Math.min(36, slot * 0.7);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bar chart" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => { const v = max * t; const yy = pad.t + (1 - t) * (H - pad.t - pad.b); return <g key={t}><line x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} stroke="#EFEBE1" /><text x={pad.l - 6} y={yy + 3} textAnchor="end" fontSize="10" fill="#7A7366">{format(Math.round(v))}</text></g>; })}
        {data.map((row, i) => {
          const h = ((row[yKey] || 0) / max) * (H - pad.t - pad.b);
          const bx = pad.l + slot * i + (slot - barW) / 2;
          return (
            <g key={row[xKey]} onMouseEnter={() => setHover(i)}>
              <rect x={bx} y={H - pad.b - h} width={barW} height={Math.max(h, row[yKey] ? 1 : 0)} rx="3" fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={bx + barW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#7A7366">{String(row[xKey]).slice(-5)}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null ? <div className="pointer-events-none absolute right-2 top-1 rounded-lg border border-[#E2DCCF] bg-white px-2.5 py-1.5 text-xs shadow"><p className="font-medium text-[#2B2823]">{data[hover][xKey]}</p><p className="text-[#5B554A]">{format(data[hover][yKey] || 0)}</p></div> : null}
    </div>
  );
}

/** Horizontal bars for ranked lists (popular templates, plans). */
export function RankedBars({ rows = [], labelKey, valueKey, color = '#5E7B5F', suffix = '' }) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-[#7A7366]">No data yet.</p>;
  const max = Math.max(1, ...rows.map((row) => row[valueKey] || 0));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row[labelKey]}>
          <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate font-medium text-[#2B2823]">{row[labelKey]}</span><span className="shrink-0 text-[#7A7366]">{fmt(row[valueKey])}{suffix}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-[#EFEBE1]"><div className="h-full rounded-full" style={{ width: `${Math.max(3, ((row[valueKey] || 0) / max) * 100)}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}

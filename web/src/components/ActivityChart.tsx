"use client";

import { useState } from "react";
import type { DayTotals } from "@/lib/profile";
import { useBarPaint } from "./BarStyle";
import { duration, shortDay } from "./format";

const ALL_SERIES = [
  { key: "humanSec", label: "Human", color: "var(--human)" },
  { key: "agentSec", label: "Agents", color: "var(--agent)" },
  { key: "meetingSec", label: "Meetings", color: "var(--meeting)" },
] as const;
type Series = (typeof ALL_SERIES)[number];

const H = 280;
const LEFT = 30;
const BOTTOM = 24;
const TOP = 6;

/**
 * Grouped daily bars on one hours axis: human, agent and meeting time.
 * Hover (or focus) a day for exact values.
 */
/** Days come with hidden categories as null; only visible series are drawn. */
function Chart({ days, series, className, W, linkDays }: { days: DayTotals[]; series: Series[]; className: string; W: number; linkDays: boolean }) {
  const SERIES = series;
  const [active, setActive] = useState<number | null>(null);
  const { defs, paint } = useBarPaint(SERIES.map((s) => ({ key: s.key, color: s.color })));
  const max = Math.max(1, ...days.flatMap((d) => SERIES.map((s) => (d[s.key] ?? 0) / 3600)));
  const step = max > 16 ? 8 : max > 8 ? 4 : max > 4 ? 2 : 1;
  const top = Math.ceil(max / step) * step;
  const plotH = H - TOP - BOTTOM;
  const slot = (W - LEFT) / days.length;
  const gap = 2;
  const n = Math.max(1, SERIES.length);
  const barW = Math.max(3, Math.min(9, (slot - 6 - gap * (n - 1)) / n));
  const group = barW * n + gap * (n - 1);
  const y = (sec: number) => TOP + plotH - (sec / 3600 / top) * plotH;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const labelEvery = days.length > 20 ? 7 : days.length > 10 ? 3 : 1;

  return (
    <svg className={`chart ${className}`} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Human, agent and meeting hours per day, last ${days.length} days`}>
      {defs}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W} y1={y(t * 3600)} y2={y(t * 3600)} stroke="var(--line-soft)" strokeWidth="1" />
          <text x={LEFT - 8} y={y(t * 3600) + 4} textAnchor="end">{t}h</text>
        </g>
      ))}
      {days.map((d, i) => {
        const x0 = LEFT + i * slot;
        const gx = x0 + (slot - group) / 2;
        const bar = (
          <g key={d.day} tabIndex={linkDays ? -1 : 0} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            aria-label={`${shortDay(d.day)}: ${SERIES.map((s) => `${duration(d[s.key] ?? 0)} ${s.label.toLowerCase()}`).join(", ")}`}>
            <rect x={x0 + 1} y={TOP} width={slot - 2} height={plotH} rx="6" fill={active === i ? "var(--raised)" : "transparent"} />
            {SERIES.map((s, j) => {
              const sec = d[s.key] ?? 0;
              if (sec <= 0) return null;
              const h = Math.max(2, TOP + plotH - y(sec));
              return <path key={s.key} d={roundedTop(gx + j * (barW + gap), TOP + plotH - h, barW, h, Math.min(3, barW / 2))} {...paint(s.key, s.color)} />;
            })}
            {(days.length - 1 - i) % labelEvery === 0 ? <text x={x0 + slot / 2} y={H - 6} textAnchor="middle">{shortDay(d.day)}</text> : null}
          </g>
        );
        // Your own chart: each day opens that day's page.
        return linkDays ? <a key={d.day} href={`/day?d=${d.day}`} aria-label={`Open ${shortDay(d.day)}`}>{bar}</a> : bar;
      })}
      {active !== null ? <Tip day={days[active]!} series={SERIES} x={LEFT + active * slot + slot / 2} W={W} /> : null}
    </svg>
  );
}

function Tip({ day, series, x, W }: { day: DayTotals; series: Series[]; x: number; W: number }) {
  const SERIES = series;
  const w = 150;
  const tx = Math.min(Math.max(x - w / 2, LEFT), W - w);
  return (
    <g className="tip" transform={`translate(${tx} ${TOP})`} pointerEvents="none">
      <rect width={w} height={31 + SERIES.length * 15} rx="10" />
      <text x="12" y="20" className="tip-day">{shortDay(day.day)}</text>
      {SERIES.map((s, j) => (
        <g key={s.key} transform={`translate(12 ${36 + j * 15})`}>
          <circle cx="3" cy="-4" r="3" fill={s.color} />
          <text x="12" y="0">{s.label}</text>
          <text x={w - 24} y="0" textAnchor="end">{duration(day[s.key] ?? 0)}</text>
        </g>
      ))}
    </g>
  );
}

/** A bar with rounded top corners and a square base on the axis. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function ActivityChart({ days, linkDays = false }: { days: DayTotals[]; linkDays?: boolean }) {
  const series = ALL_SERIES.filter((s) => days.every((d) => d[s.key] !== null));
  return (
    <>
      <div className="legend" style={{ marginBottom: 16 }}>
        {series.map((s) => <span key={s.key}><i className="dot" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <Chart days={days} series={series} className="chart-long" W={760} linkDays={linkDays} />
      <Chart days={days.slice(-14)} series={series} className="chart-short" W={380} linkDays={linkDays} />
    </>
  );
}

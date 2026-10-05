"use client";

import { useState } from "react";
import type { HourTotals } from "@/lib/day-view";
import type { DayTotals } from "@/lib/profile";
import { duration, shortDay } from "./format";

const SERIES = [
  { key: "humanSec", label: "Human", color: "var(--human)" },
  { key: "agentSec", label: "Agents", color: "var(--agent)" },
  { key: "meetingSec", label: "Meetings", color: "var(--meeting)" },
] as const;
type Key = (typeof SERIES)[number]["key"];

const LEFT = 36;
const TOP = 8;
const BOTTOM = 24;

function Legend({ keys }: { keys: readonly Key[] }) {
  return (
    <div className="legend" style={{ marginBottom: 16 }}>
      {SERIES.filter((s) => keys.includes(s.key)).map((s) => <span key={s.key}><i className="dot" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

function Tip({ x, W, title, rows }: { x: number; W: number; title: string; rows: Array<{ color: string; label: string; value: string }> }) {
  const w = 168;
  const tx = Math.min(Math.max(x - w / 2, LEFT), W - w);
  return (
    <g className="tip" transform={`translate(${tx} ${TOP})`} pointerEvents="none">
      <rect width={w} height={31 + rows.length * 15} rx="10" />
      <text x="12" y="20" className="tip-day">{title}</text>
      {rows.map((r, j) => (
        <g key={r.label} transform={`translate(12 ${36 + j * 15})`}>
          <circle cx="3" cy="-4" r="3" fill={r.color} />
          <text x="12" y="0">{r.label}</text>
          <text x={w - 24} y="0" textAnchor="end">{r.value}</text>
        </g>
      ))}
    </g>
  );
}

/** Grouped bars per hour of one day, in minutes (0–60 a series). */
export function HourChart({ hours }: { hours: HourTotals[] }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 760;
  const H = 240;
  const plotH = H - TOP - BOTTOM;
  const slot = (W - LEFT) / 24;
  const barW = Math.max(3, Math.min(7, (slot - 8) / 3));
  const group = barW * 3 + 4;
  // Up to 60 minutes an hour each, but agents in parallel can pass 60: the axis grows to fit.
  const axisMin = Math.max(60, Math.ceil(Math.max(...hours.map((h) => h.agentSec / 60)) / 30) * 30);
  const yy = (sec: number) => TOP + plotH - (sec / 60 / axisMin) * plotH;
  const ticks = [0, axisMin / 2, axisMin];

  return (
    <>
      <Legend keys={["humanSec", "agentSec", "meetingSec"]} />
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Human, agent and meeting minutes per hour">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={yy(t * 60)} y2={yy(t * 60)} stroke="var(--line-soft)" />
            <text x={LEFT - 8} y={yy(t * 60) + 4} textAnchor="end">{t}m</text>
          </g>
        ))}
        {hours.map((h, i) => {
          const x0 = LEFT + i * slot;
          const gx = x0 + (slot - group) / 2;
          return (
            <g key={h.hour} tabIndex={0} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              aria-label={`${h.hour}:00: ${SERIES.map((s) => `${duration(h[s.key])} ${s.label.toLowerCase()}`).join(", ")}`}>
              <rect x={x0 + 1} y={TOP} width={slot - 2} height={plotH} rx="5" fill={active === i ? "var(--raised)" : "transparent"} />
              {SERIES.map((s, j) => {
                const sec = h[s.key];
                if (sec <= 0) return null;
                const top = yy(sec);
                return <rect key={s.key} x={gx + j * (barW + 2)} y={top} width={barW} height={Math.max(2, TOP + plotH - top)} rx={Math.min(2, barW / 2)} fill={s.color} />;
              })}
              {i % 3 === 0 ? <text x={x0 + slot / 2} y={H - 6} textAnchor="middle">{h.hour}:00</text> : null}
            </g>
          );
        })}
        {active !== null ? (
          <Tip x={LEFT + active * slot + slot / 2} W={W} title={`${hours[active]!.hour}:00 to ${hours[active]!.hour + 1}:00`}
            rows={SERIES.map((s) => ({ color: s.color, label: s.label, value: duration(hours[active]![s.key]) }))} />
        ) : null}
      </svg>
    </>
  );
}

/**
 * Lines over time: per day (a 7-day average, so the trend shows through
 * weekends) or the running total. Hidden categories arrive as null and aren't drawn.
 */
export function TrendChart({ days }: { days: DayTotals[] }) {
  const [mode, setMode] = useState<"daily" | "total">("daily");
  const [active, setActive] = useState<number | null>(null);
  const keys = SERIES.map((s) => s.key).filter((k) => days.every((d) => d[k] !== null));
  if (days.length < 2) return <p className="empty" style={{ margin: 0 }}>The trend starts after your second day.</p>;

  const W = 760;
  const H = 260;
  const plotH = H - TOP - BOTTOM;
  const values: Record<Key, number[]> = { humanSec: [], agentSec: [], meetingSec: [] };
  for (const k of keys) {
    let run = 0;
    values[k] = days.map((d, i) => {
      if (mode === "total") return (run += d[k] ?? 0);
      const window = days.slice(Math.max(0, i - 6), i + 1);
      return window.reduce((s, w) => s + (w[k] ?? 0), 0) / window.length;
    });
  }
  const maxH = Math.max(1, ...keys.flatMap((k) => values[k].map((v) => v / 3600)));
  const step = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => maxH / s <= 5) ?? 1000;
  const top = Math.ceil(maxH / step) * step;
  const x = (i: number) => LEFT + (i / (days.length - 1)) * (W - LEFT - 8);
  const y = (sec: number) => TOP + plotH - (sec / 3600 / top) * plotH;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - LEFT - 8);
    setActive(Math.max(0, Math.min(days.length - 1, Math.round((px / (W - LEFT - 8)) * (days.length - 1)))));
  }

  return (
    <>
      <div className="trend-head">
        <Legend keys={keys} />
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={mode === "daily"} onClick={() => setMode("daily")}>Per day</button>
          <button aria-pressed={mode === "total"} onClick={() => setMode("total")}>Running total</button>
        </div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={mode === "daily" ? "Hours per day, 7-day average" : "Total hours over time"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t * 3600)} y2={y(t * 3600)} stroke="var(--line-soft)" />
            <text x={LEFT - 8} y={y(t * 3600) + 4} textAnchor="end">{t}h</text>
          </g>
        ))}
        {days.map((d, i) => (days.length - 1 - i) % labelEvery === 0
          ? <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle">{shortDay(d.day)}</text> : null)}
        {keys.map((k) => {
          const s = SERIES.find((ser) => ser.key === k)!;
          return <polyline key={k} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            points={values[k].map((v, i) => `${x(i)},${y(v)}`).join(" ")} />;
        })}
        {active !== null ? (
          <>
            <line x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + plotH} stroke="var(--line)" />
            {keys.map((k) => (
              <circle key={k} cx={x(active)} cy={y(values[k][active]!)} r="4.5" fill={SERIES.find((s) => s.key === k)!.color}
                stroke="var(--panel)" strokeWidth="2" />
            ))}
            <Tip x={x(active)} W={W} title={mode === "daily" ? `${shortDay(days[active]!.day)}, 7-day avg` : `Total to ${shortDay(days[active]!.day)}`}
              rows={keys.map((k) => { const s = SERIES.find((ser) => ser.key === k)!; return { color: s.color, label: s.label, value: duration(values[k][active]!) }; })} />
          </>
        ) : null}
        <rect x={LEFT} y={TOP} width={W - LEFT} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setActive(null)} />
      </svg>
    </>
  );
}

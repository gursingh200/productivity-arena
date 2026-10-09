"use client";

import { useState } from "react";
import type { HourTotals } from "@/lib/day-view";
import type { DayTotals } from "@/lib/profile";
import { useBarPaint } from "./BarStyle";
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
  const { defs, paint } = useBarPaint(SERIES.map((s) => ({ key: s.key, color: s.color })));
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
        {defs}
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
                return <rect key={s.key} x={gx + j * (barW + 2)} y={top} width={barW} height={Math.max(2, TOP + plotH - top)} rx={Math.min(2, barW / 2)} {...paint(s.key, s.color)} />;
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

const isMonday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() === 1;

/**
 * Lines over time: each day's hours, or the running total, with a faint line
 * at the start of every week. "Hide empty days" skips the days a line has
 * nothing (weekends off, holidays, away), joining the days either side; the
 * time axis stays as it is, so weeks still line up.
 */
export function TrendChart({ days }: { days: DayTotals[] }) {
  const [mode, setMode] = useState<"daily" | "total">("daily");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const keys = SERIES.map((s) => s.key).filter((k) => days.every((d) => d[k] !== null));
  if (days.length < 2) return <p className="empty" style={{ margin: 0 }}>The trend starts after your second day.</p>;

  const W = 760;
  const H = 260;
  const plotH = H - TOP - BOTTOM;
  const values: Record<Key, number[]> = { humanSec: [], agentSec: [], meetingSec: [] };
  for (const k of keys) {
    let run = 0;
    values[k] = days.map((d) => (mode === "total" ? (run += d[k] ?? 0) : d[k] ?? 0));
  }
  // Which points each line draws.
  const drawn = (k: Key, i: number) => mode === "total" || !hideEmpty || (days[i]![k] ?? 0) > 0;
  const maxH = Math.max(1, ...keys.flatMap((k) => values[k].map((v) => v / 3600)));
  const step = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((st) => maxH / st <= 5) ?? 1000;
  const top = Math.ceil(maxH / step) * step;
  const x = (i: number) => LEFT + (i / (days.length - 1)) * (W - LEFT - 8);
  const y = (sec: number) => TOP + plotH - (sec / 3600 / top) * plotH;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  // Week starts: a line at each Monday, labelled; with many weeks, every few.
  const mondays = days.map((d, i) => ({ d, i })).filter(({ d }) => isMonday(d.day));
  const labelEvery = Math.max(1, Math.ceil(mondays.length / 8));
  const dayLabels = days.length <= 10; // a short span labels every day instead

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    setActive(Math.max(0, Math.min(days.length - 1, Math.round(f * (days.length - 1)))));
  }

  return (
    <>
      <div className="trend-head">
        <Legend keys={keys} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={mode === "daily"} onClick={() => setMode("daily")}>Per day</button>
            <button aria-pressed={mode === "total"} onClick={() => setMode("total")}>Running total</button>
          </div>
          {mode === "daily" ? (
            <div className="seg">
              <button aria-pressed={hideEmpty} onClick={() => setHideEmpty(!hideEmpty)}>Hide empty days</button>
            </div>
          ) : null}
        </div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={mode === "daily" ? "Hours per day" : "Total hours over time"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t * 3600)} y2={y(t * 3600)} stroke="var(--line-soft)" />
            <text x={LEFT - 8} y={y(t * 3600) + 4} textAnchor="end">{t}h</text>
          </g>
        ))}
        {mondays.map(({ d, i }, n) => (
          <g key={d.day}>
            <line x1={x(i)} x2={x(i)} y1={TOP} y2={TOP + plotH} stroke="var(--line)" strokeDasharray="3 4" />
            {!dayLabels && n % labelEvery === 0 ? <text x={x(i)} y={H - 6} textAnchor="middle">{shortDay(d.day)}</text> : null}
          </g>
        ))}
        {dayLabels ? days.map((d, i) => <text key={d.day} x={x(i)} y={H - 6} textAnchor="middle">{shortDay(d.day)}</text>) : null}
        {keys.map((k) => {
          const s = SERIES.find((ser) => ser.key === k)!;
          const pts = values[k].map((v, i) => (drawn(k, i) ? `${x(i)},${y(v)}` : null)).filter(Boolean);
          return (
            <g key={k}>
              <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.join(" ")} />
              {pts.length === 1 ? <circle cx={pts[0]!.split(",")[0]} cy={pts[0]!.split(",")[1]} r="3" fill={s.color} /> : null}
            </g>
          );
        })}
        {active !== null ? (
          <>
            <line x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + plotH} stroke="var(--text-2)" strokeOpacity="0.5" />
            {keys.filter((k) => drawn(k, active)).map((k) => (
              <circle key={k} cx={x(active)} cy={y(values[k][active]!)} r="4.5" fill={SERIES.find((ser) => ser.key === k)!.color}
                stroke="var(--panel)" strokeWidth="2" />
            ))}
            <Tip x={x(active)} W={W} title={mode === "daily" ? shortDay(days[active]!.day) : `Total to ${shortDay(days[active]!.day)}`}
              rows={keys.map((k) => { const s = SERIES.find((ser) => ser.key === k)!; return { color: s.color, label: s.label, value: duration(values[k][active]!) }; })} />
          </>
        ) : null}
        <rect x={LEFT} y={TOP} width={W - LEFT} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setActive(null)} />
      </svg>
    </>
  );
}

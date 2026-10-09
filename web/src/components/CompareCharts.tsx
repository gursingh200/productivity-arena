"use client";

import { useState } from "react";
import type { DayTotals } from "@/lib/profile";
import { duration, shortDay } from "./format";
import { Radar, SCALE_NOTE, SKILLS, type Scale } from "./Radar";
import { ScaleSwitch, type ScaledScores } from "./SkillsPanel";

export interface Side { name: string; color: string }

/** Both radars on one chart, a scale switch, and who leads each axis. */
export function CompareRadar({ a, b, skillsA, skillsB }: { a: Side; b: Side; skillsA: ScaledScores; skillsB: ScaledScores }) {
  const [scale, setScale] = useState<Scale>("team");
  const pick = (s: ScaledScores) => (scale === "guild" && s.guild ? s.guild : scale === "absolute" ? s.absolute : s.team);
  const sa = pick(skillsA);
  const sb = pick(skillsB);
  return (
    <>
      <div className="trend-head" style={{ marginBottom: 6 }}>
        <p className="help" style={{ margin: 0 }}>{SCALE_NOTE[scale]}</p>
        <ScaleSwitch scale={scale} onChange={setScale} guild={skillsA.guild !== null && skillsB.guild !== null} />
      </div>
      <div className="skills">
        <Radar series={[{ label: a.name, color: a.color, scores: sa }, { label: b.name, color: b.color, scores: sb }]} />
        <div>
          <div className="legend" style={{ marginBottom: 12 }}>
            <span><i className="dot" style={{ background: a.color }} />{a.name}</span>
            <span><i className="dot" style={{ background: b.color }} />{b.name}</span>
          </div>
          {SKILLS.map(({ key, name }) => {
            const x = sa[key];
            const y = sb[key];
            const lead = x === null || y === null || x === y ? null : x > y ? a : b;
            return (
              <div className="vs-row" key={key}>
                <span className={`num${lead === a ? " vs-lead" : ""}`}>{x === null ? "–" : x.toFixed(1)}</span>
                <span className="vs-label">{name}{lead ? <small style={{ color: lead.color }}> {lead.name} {lead.name === "You" ? "lead" : "leads"}</small> : null}</span>
                <span className={`num${lead === b ? " vs-lead" : ""}`}>{y === null ? "–" : y.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

type Metric = "humanSec" | "agentSec";
const METRIC_LABEL: Record<Metric, string> = { humanSec: "Human", agentSec: "Agents" };

/** Both people's daily hours on one chart, for one metric at a time. Days without data for a person aren't drawn. */
export function CompareTrend({ a, b, daysA, daysB }: { a: Side; b: Side; daysA: DayTotals[]; daysB: DayTotals[] }) {
  const metrics = (["humanSec", "agentSec"] as Metric[]).filter((m) => daysA.some((d) => d[m] !== null) && daysB.some((d) => d[m] !== null));
  const [metric, setMetric] = useState<Metric>(metrics[0] ?? "humanSec");
  const [active, setActive] = useState<number | null>(null);
  if (metrics.length === 0) return <p className="empty" style={{ margin: 0 }}>Neither human nor agent hours are shared between you.</p>;

  const allDays = [...new Set([...daysA, ...daysB].map((d) => d.day))].sort();
  if (allDays.length < 2) return <p className="empty" style={{ margin: 0 }}>The trend starts after the second day.</p>;
  const value = (days: DayTotals[], day: string) => days.find((d) => d.day === day)?.[metric] ?? null;
  const W = 760;
  const H = 240;
  const LEFT = 36;
  const TOP = 8;
  const plotH = H - TOP - 24;
  const maxH = Math.max(1, ...allDays.flatMap((d) => [value(daysA, d) ?? 0, value(daysB, d) ?? 0]).map((s) => s / 3600));
  const step = [1, 2, 4, 5, 10].find((s) => maxH / s <= 5) ?? 10;
  const top = Math.ceil(maxH / step) * step;
  const x = (i: number) => LEFT + (i / (allDays.length - 1)) * (W - LEFT - 8);
  const y = (sec: number) => TOP + plotH - (sec / 3600 / top) * plotH;
  const line = (days: DayTotals[]) => allDays.map((d, i) => {
    const v = value(days, d);
    return v ? `${x(i)},${y(v)}` : null; // skip empty days, like the profile trend
  }).filter(Boolean).join(" ");
  const labelEvery = Math.max(1, Math.ceil(allDays.length / 6));

  return (
    <>
      <div className="trend-head">
        <div className="legend" style={{ marginBottom: 16 }}>
          <span><i className="dot" style={{ background: a.color }} />{a.name}</span>
          <span><i className="dot" style={{ background: b.color }} />{b.name}</span>
        </div>
        {metrics.length > 1 ? (
          <div className="seg" role="group" aria-label="Show">
            {metrics.map((m) => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{METRIC_LABEL[m]}</button>)}
          </div>
        ) : null}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${METRIC_LABEL[metric]} hours per day, ${a.name} and ${b.name}`}>
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t * 3600)} y2={y(t * 3600)} stroke="var(--line-soft)" />
            <text x={LEFT - 8} y={y(t * 3600) + 4} textAnchor="end">{t}h</text>
          </g>
        ))}
        {allDays.map((d, i) => (allDays.length - 1 - i) % labelEvery === 0 ? <text key={d} x={x(i)} y={H - 6} textAnchor="middle">{shortDay(d)}</text> : null)}
        {[{ s: a, days: daysA }, { s: b, days: daysB }].map(({ s, days }) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={line(days)} />
        ))}
        {active !== null ? (
          <g className="tip" transform={`translate(${Math.min(Math.max(x(active) - 84, LEFT), W - 168)} ${TOP})`} pointerEvents="none">
            <rect width="168" height="61" rx="10" />
            <text x="12" y="20" className="tip-day">{shortDay(allDays[active]!)}</text>
            {[{ s: a, days: daysA }, { s: b, days: daysB }].map(({ s, days }, j) => (
              <g key={s.name} transform={`translate(12 ${36 + j * 15})`}>
                <circle cx="3" cy="-4" r="3" fill={s.color} />
                <text x="12" y="0">{s.name}</text>
                <text x="144" y="0" textAnchor="end">{duration(value(days, allDays[active]!) ?? 0)}</text>
              </g>
            ))}
          </g>
        ) : null}
        <rect x={LEFT} y={TOP} width={W - LEFT} height={plotH} fill="transparent"
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setActive(Math.max(0, Math.min(allDays.length - 1, Math.round(((e.clientX - box.left) / box.width) * (allDays.length - 1)))));
          }}
          onMouseLeave={() => setActive(null)} />
      </svg>
    </>
  );
}

/** Average active minutes in each hour of the day, both people side by side. */
export function CompareHours({ a, b, hoursA, hoursB }: { a: Side; b: Side; hoursA: number[]; hoursB: number[] }) {
  const W = 760;
  const H = 200;
  const LEFT = 36;
  const TOP = 8;
  const plotH = H - TOP - 24;
  const slot = (W - LEFT) / 24;
  const barW = Math.min(8, (slot - 6) / 2);
  const max = Math.max(10, ...hoursA, ...hoursB);
  const y = (min: number) => TOP + plotH - (min / max) * plotH;
  const peak = (h: number[]) => h.indexOf(Math.max(...h));
  return (
    <>
      <div className="legend" style={{ marginBottom: 16 }}>
        <span><i className="dot" style={{ background: a.color }} />{a.name}, busiest {peak(hoursA)}:00</span>
        <span><i className="dot" style={{ background: b.color }} />{b.name}, busiest {peak(hoursB)}:00</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Active minutes by hour of day, ${a.name} and ${b.name}`}>
        {[0, Math.round(max / 2), Math.round(max)].map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end">{t}m</text>
          </g>
        ))}
        {Array.from({ length: 24 }, (_, h) => {
          const gx = LEFT + h * slot + (slot - (barW * 2 + 2)) / 2;
          return (
            <g key={h}>
              {[{ v: hoursA[h]!, c: a.color, i: 0 }, { v: hoursB[h]!, c: b.color, i: 1 }].map(({ v, c, i }) => v > 0
                ? <rect key={i} x={gx + i * (barW + 2)} y={y(v)} width={barW} height={TOP + plotH - y(v)} rx="2" fill={c}><title>{`${h}:00, ${Math.round(v)} min a day`}</title></rect>
                : null)}
              {h % 3 === 0 ? <text x={LEFT + h * slot + slot / 2} y={H - 6} textAnchor="middle">{h}:00</text> : null}
            </g>
          );
        })}
      </svg>
    </>
  );
}

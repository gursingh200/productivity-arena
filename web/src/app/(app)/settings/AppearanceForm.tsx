"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BarStyleProvider, useBarPaint } from "@/components/BarStyle";
import { BrandMark } from "@/components/BrandMark";
import {
  ACCENTS, appearanceVars, BACKGROUNDS, BAR_STYLES, DEFAULT_APPEARANCE, PALETTES,
  type Appearance, type BarStyle,
} from "@/lib/colours";

type Key = keyof Appearance;

/**
 * Pick a background, palette, accent and bar style. Like a crosshair editor:
 * hovering an option shows it in the preview straight away, clicking picks it,
 * Save applies it everywhere.
 */
export default function AppearanceForm({ initial }: { initial: Appearance }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Appearance>(initial);
  const [hover, setHover] = useState<Partial<Appearance>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const preview: Appearance = { ...chosen, ...hover };
  const dirty = (Object.keys(chosen) as Key[]).some((k) => chosen[k] !== initial[k]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/appearance", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chosen),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMessage({ ok: true, text: "Saved. Your Mac’s dashboard picks it up on its next sync." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Couldn’t save. Check that you’re still signed in, then try again." });
    } finally {
      setSaving(false);
    }
  }

  const option = (key: Key, id: string, label: string, swatch: React.ReactNode) => (
    <button key={id} type="button" role="radio" aria-checked={chosen[key] === id} className="look-option"
      onMouseEnter={() => setHover({ [key]: id })} onMouseLeave={() => setHover({})}
      onFocus={() => setHover({ [key]: id })} onBlur={() => setHover({})}
      onClick={() => setChosen({ ...chosen, [key]: id })}>
      {swatch}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="look">
      <div className="look-options">
        <Group title="Background">
          {BACKGROUNDS.map((b) => option("background", b.id, b.name,
            <span className="look-swatch bg" style={{ background: b.bg }}><i style={{ background: b.panel, borderColor: b.line }} /></span>))}
        </Group>
        <Group title="Human, agents and meetings" note="Every palette stays readable for colour-blind eyes, on every background.">
          {PALETTES.map((p) => option("palette", p.id, p.name,
            <span className="swatches">{[p.human, p.agent, p.meeting].map((c) => <i key={c} style={{ background: c }} />)}</span>))}
        </Group>
        <Group title="Accent" note="The logo, the tab icon, XP numbers, progress bars and highlights.">
          {ACCENTS.map((a) => option("accent", a.id, a.name, <span className="swatches"><i style={{ background: a.colour }} /></span>))}
        </Group>
        <Group title="Bars" note="How bars look in charts and on the leaderboard.">
          {BAR_STYLES.map((s) => option("barStyle", s.id, s.name, <BarGlyph style={s.id} />))}
        </Group>
        <div className="look-actions">
          <button className="btn" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save appearance"}</button>
          <button className="btn btn-quiet" onClick={() => setChosen(DEFAULT_APPEARANCE)} disabled={saving}>Reset to default</button>
        </div>
        {message ? <p className={`notice${message.ok ? "" : " notice-err"}`} role="status" style={{ marginTop: 14, marginBottom: 0 }}>{message.text}</p> : null}
      </div>
      <Preview appearance={preview} />
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="look-group">
      <legend>{title}</legend>
      {note ? <p className="help" style={{ margin: "0 0 10px" }}>{note}</p> : null}
      <div className="look-grid" role="radiogroup" aria-label={title}>{children}</div>
    </fieldset>
  );
}

/** Three little bars drawn in a bar style, for the option buttons. */
function BarGlyph({ style }: { style: BarStyle }) {
  return (
    <BarStyleProvider value={style}>
      <Bars heights={[0.55, 1, 0.75]} width={30} height={20} />
    </BarStyleProvider>
  );
}

function Bars({ heights, width, height }: { heights: number[]; width: number; height: number }) {
  const series = [{ key: "h", color: "var(--human)" }, { key: "a", color: "var(--agent)" }, { key: "m", color: "var(--meeting)" }];
  const { defs, paint } = useBarPaint(series);
  const w = width / (heights.length * 1.6);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {defs}
      {heights.map((h, i) => (
        <rect key={i} x={i * w * 1.6 + 1} y={height * (1 - h)} width={w} height={height * h} rx="1.5" {...paint(series[i % 3]!.key, series[i % 3]!.color)} />
      ))}
    </svg>
  );
}

/** A small Arena page in the previewed appearance. */
function Preview({ appearance }: { appearance: Appearance }) {
  const vars = appearanceVars(appearance) as React.CSSProperties;
  const week = [[0.6, 0.9, 0.1], [0.7, 0.6, 0.3], [0.5, 1, 0], [0.8, 0.7, 0.2], [0.65, 0.85, 0.15], [0.2, 0.4, 0], [0.1, 0.3, 0]];
  return (
    <div className="look-preview" style={vars} data-bars={appearance.barStyle} aria-label="Preview">
      <BarStyleProvider value={appearance.barStyle}>
        <div className="look-top"><BrandMark size={18} /><span>Arena</span><span className="look-pill">Home</span></div>
        <div className="look-card">
          <div className="look-row">
            <div><i className="dot dot-human" />Human<b>6h 15m</b></div>
            <div><i className="dot dot-agent" />Agents<b>13h 12m</b></div>
            <div><i className="dot dot-meeting" />Meetings<b>45m</b></div>
          </div>
          <WeekChart week={week} />
        </div>
        <div className="look-card">
          <div className="look-board">
            <span className="num" style={{ color: "var(--xp)" }}>1</span>
            <span>Priya</span>
            <span className="split-bar"><span style={{ width: "42%", background: "var(--human)", color: "var(--human)" }} /><span style={{ width: "38%", background: "var(--agent)", color: "var(--agent)" }} /></span>
            <b className="num" style={{ color: "var(--xp)" }}>2,340 XP</b>
          </div>
          <div className="look-quest">
            <span>20 hours of focus</span><b style={{ color: "var(--xp)" }}>+300 XP</b>
            <span className="look-progress"><i /></span>
          </div>
        </div>
      </BarStyleProvider>
    </div>
  );
}

function WeekChart({ week }: { week: number[][] }) {
  const series = [{ key: "h", color: "var(--human)" }, { key: "a", color: "var(--agent)" }, { key: "m", color: "var(--meeting)" }];
  const { defs, paint } = useBarPaint(series);
  const W = 280;
  const H = 90;
  const slot = W / week.length;
  const bw = 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="look-chart" aria-hidden>
      {defs}
      <line x1="0" x2={W} y1={H - 1} y2={H - 1} stroke="var(--line)" />
      {week.map((day, d) => day.map((v, s) => v > 0 ? (
        <rect key={`${d}-${s}`} x={d * slot + (slot - bw * 3 - 4) / 2 + s * (bw + 2)} y={H - 1 - v * (H - 6)} width={bw}
          height={v * (H - 6)} rx="2" {...paint(series[s]!.key, series[s]!.color)} />
      ) : null))}
    </svg>
  );
}

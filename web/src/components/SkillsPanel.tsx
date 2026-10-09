"use client";

import { useState } from "react";
import { Radar, SCALE_NOTE, SkillList, type Scale, type Scores } from "./Radar";

export interface ScaledScores {
  absolute: Scores;
  team: Scores;
  guild: Scores | null;
}

const LABELS: Record<Scale, string> = { team: "Team", guild: "Guild", absolute: "Absolute" };

/** The scale switch shared by the profile panel and Compare. Guild shows only when every person has one. */
export function ScaleSwitch({ scale, onChange, guild }: { scale: Scale; onChange: (s: Scale) => void; guild: boolean }) {
  return (
    <div className="seg" role="group" aria-label="Scale">
      {(["team", ...(guild ? ["guild"] : []), "absolute"] as Scale[]).map((s) => (
        <button key={s} aria-pressed={scale === s} onClick={() => onChange(s)}>{LABELS[s]}</button>
      ))}
    </div>
  );
}

/** One person's radar and scores, with the Team / Guild / Absolute switch. */
export function SkillsPanel({ skills }: { skills: ScaledScores }) {
  const [scale, setScale] = useState<Scale>("team");
  const scores = scale === "guild" && skills.guild ? skills.guild : scale === "absolute" ? skills.absolute : skills.team;
  return (
    <>
      <div className="trend-head" style={{ marginBottom: 6 }}>
        <p className="help" style={{ margin: 0 }}>{SCALE_NOTE[scale]}</p>
        <ScaleSwitch scale={scale} onChange={setScale} guild={skills.guild !== null} />
      </div>
      <div className="skills">
        <Radar series={[{ label: "Skills", color: "var(--human)", scores }]} />
        <SkillList skills={scores} scale={scale} />
      </div>
    </>
  );
}

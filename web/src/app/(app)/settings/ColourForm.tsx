"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACCENTS, PALETTES } from "@/lib/colours";

export default function ColourForm({ palette, accent }: { palette: string; accent: string }) {
  const router = useRouter();
  const [p, setP] = useState(palette);
  const [a, setA] = useState(accent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save(next: { palette: string; accent: string }) {
    setP(next.palette);
    setA(next.accent);
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/settings/colours", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="field" style={{ marginBottom: 22 }}>
        <span className="label-like">Human, agents and meetings</span>
        <div className="palette-options" role="radiogroup" aria-label="Palette">
          {PALETTES.map((pal) => (
            <button key={pal.id} type="button" role="radio" aria-checked={p === pal.id} className="palette-option"
              disabled={saving} onClick={() => save({ palette: pal.id, accent: a })}>
              <span className="swatches" aria-hidden>
                {[pal.human, pal.agent, pal.meeting].map((c) => <i key={c} style={{ background: c }} />)}
              </span>
              {pal.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="label-like">Accent</span>
        <div className="palette-options" role="radiogroup" aria-label="Accent">
          {ACCENTS.map((acc) => (
            <button key={acc.id} type="button" role="radio" aria-checked={a === acc.id} className="palette-option"
              disabled={saving} onClick={() => save({ palette: p, accent: acc.id })}>
              <span className="swatches" aria-hidden><i style={{ background: acc.colour }} /></span>
              {acc.name}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="notice notice-err" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>Couldn’t save your colours. Try again.</p> : null}
    </div>
  );
}

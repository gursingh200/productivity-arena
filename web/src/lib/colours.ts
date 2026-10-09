/**
 * Colour presets people can pick in Settings (only they see the change).
 * Every palette passes the dataviz checks against --panel (#17181b): lightness
 * band, chroma, colour-blind separation for all three pairs, contrast. Don't
 * add one without running scripts/validate_palette.js with --pairs all.
 */
export interface Palette { id: string; name: string; human: string; agent: string; meeting: string }

export const PALETTES: Palette[] = [
  { id: "ember", name: "Ember", human: "#e4692c", agent: "#5285e6", meeting: "#35a586" },
  { id: "aurora", name: "Aurora", human: "#e0663c", agent: "#7b6fe0", meeting: "#2fa39a" },
  { id: "dusk", name: "Dusk", human: "#d4547e", agent: "#4b8ad6", meeting: "#b08a1e" },
  { id: "classic", name: "Okabe–Ito", human: "#d55e00", agent: "#0072b2", meeting: "#009e73" },
];

/** Accent: buttons, links, focus rings and XP numbers. */
export const ACCENTS: Array<{ id: string; name: string; colour: string }> = [
  { id: "ember", name: "Ember", colour: "#f08a4b" },
  { id: "rose", name: "Rose", colour: "#ef7aa0" },
  { id: "violet", name: "Violet", colour: "#a48cf5" },
  { id: "sky", name: "Sky", colour: "#6cb2f0" },
  { id: "mint", name: "Mint", colour: "#5fcf9f" },
  { id: "gold", name: "Gold", colour: "#e6bd4f" },
];

export const DEFAULT_PALETTE = "ember";
export const DEFAULT_ACCENT = "ember";

/** CSS overriding the colour tokens for someone's choice; empty for the defaults. */
export function colourCss(paletteId: string | null, accentId: string | null): string {
  const palette = PALETTES.find((p) => p.id === paletteId);
  const accent = ACCENTS.find((a) => a.id === accentId);
  const rules: string[] = [];
  if (palette && palette.id !== DEFAULT_PALETTE) {
    rules.push(`--human: ${palette.human}`, `--agent: ${palette.agent}`, `--meeting: ${palette.meeting}`);
    // The focus heatmap follows the human colour.
    [1, 2, 3, 4].forEach((step, i) => rules.push(`--heat-${step}: color-mix(in srgb, ${palette.human} ${[22, 45, 70, 100][i]}%, #222327)`));
    rules.push(`--heat-5: color-mix(in srgb, ${palette.human} 75%, #ffffff)`);
  }
  if (accent && accent.id !== DEFAULT_ACCENT) rules.push(`--xp: ${accent.colour}`);
  return rules.length ? `:root { ${rules.join("; ")}; }` : "";
}

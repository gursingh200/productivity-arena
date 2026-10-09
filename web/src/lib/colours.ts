/**
 * Appearance people can pick in Settings → Appearance (only they see it):
 * background, data palette, accent and bar style.
 *
 * Every palette passes the dataviz checks on every background's panel colour
 * (lightness band, chroma, colour-blind separation for all three pairs,
 * contrast). Don't add a palette or background without running
 * scripts/validate_palette.js with --pairs all against each panel.
 */
export interface Background {
  id: string;
  name: string;
  bg: string;
  panel: string;
  raised: string;
  hover: string;
  line: string;
  lineSoft: string;
}

export const BACKGROUNDS: Background[] = [
  { id: "graphite", name: "Graphite", bg: "#0f1012", panel: "#17181b", raised: "#1f2024", hover: "#26272c", line: "#2a2b30", lineSoft: "#212226" },
  { id: "midnight", name: "Midnight", bg: "#0b1020", panel: "#121a2e", raised: "#18223a", hover: "#1f2a45", line: "#27334f", lineSoft: "#1b2540" },
  { id: "oled", name: "Black", bg: "#000000", panel: "#0c0c0d", raised: "#161618", hover: "#1d1d20", line: "#232327", lineSoft: "#18181b" },
  { id: "plum", name: "Plum", bg: "#110e17", panel: "#1a1622", raised: "#221d2c", hover: "#2a2436", line: "#302a3d", lineSoft: "#251f30" },
  { id: "espresso", name: "Espresso", bg: "#12110f", panel: "#1b1a17", raised: "#23211e", hover: "#2b2925", line: "#33302b", lineSoft: "#282622" },
];

export interface Palette { id: string; name: string; human: string; agent: string; meeting: string }

export const PALETTES: Palette[] = [
  { id: "ember", name: "Ember", human: "#e4692c", agent: "#5285e6", meeting: "#35a586" },
  { id: "aurora", name: "Aurora", human: "#e0663c", agent: "#7b6fe0", meeting: "#2fa39a" },
  { id: "dusk", name: "Dusk", human: "#d4547e", agent: "#4b8ad6", meeting: "#b08a1e" },
  { id: "classic", name: "Okabe–Ito", human: "#d55e00", agent: "#0072b2", meeting: "#009e73" },
];

/** Accent: the logo, the tab icon, XP numbers, progress bars, links and focus rings. */
export const ACCENTS: Array<{ id: string; name: string; colour: string }> = [
  { id: "ember", name: "Ember", colour: "#f08a4b" },
  { id: "rose", name: "Rose", colour: "#ef7aa0" },
  { id: "violet", name: "Violet", colour: "#a48cf5" },
  { id: "sky", name: "Sky", colour: "#6cb2f0" },
  { id: "mint", name: "Mint", colour: "#5fcf9f" },
  { id: "gold", name: "Gold", colour: "#e6bd4f" },
];

/** How bars are drawn in charts and leaderboards. */
export const BAR_STYLES = [
  { id: "solid", name: "Solid" },
  { id: "striped", name: "Striped" },
  { id: "dotted", name: "Dotted" },
  { id: "soft", name: "Soft" },
  { id: "outline", name: "Outline" },
] as const;
export type BarStyle = (typeof BAR_STYLES)[number]["id"];

export interface Appearance { background: string; palette: string; accent: string; barStyle: BarStyle }

export const DEFAULT_APPEARANCE: Appearance = { background: "graphite", palette: "ember", accent: "ember", barStyle: "solid" };

/** Someone's appearance from their user row (unknown or missing ids fall back to the defaults). */
export function appearanceOf(user: { background?: string | null; palette?: string | null; accent?: string | null; barStyle?: string | null }): Appearance {
  const pick = <T extends { id: string }>(list: readonly T[], id: string | null | undefined, fallback: string) =>
    list.some((x) => x.id === id) ? id! : fallback;
  return {
    background: pick(BACKGROUNDS, user.background, DEFAULT_APPEARANCE.background),
    palette: pick(PALETTES, user.palette, DEFAULT_APPEARANCE.palette),
    accent: pick(ACCENTS, user.accent, DEFAULT_APPEARANCE.accent),
    barStyle: pick(BAR_STYLES, user.barStyle, DEFAULT_APPEARANCE.barStyle) as BarStyle,
  };
}

/** The CSS custom properties for an appearance (all of them, so a preview can scope them to a box). */
export function appearanceVars(a: Appearance): Record<string, string> {
  const bg = BACKGROUNDS.find((b) => b.id === a.background)!;
  const p = PALETTES.find((x) => x.id === a.palette)!;
  const accent = ACCENTS.find((x) => x.id === a.accent)!.colour;
  return {
    "--bg": bg.bg, "--panel": bg.panel, "--raised": bg.raised, "--hover": bg.hover, "--line": bg.line, "--line-soft": bg.lineSoft,
    "--human": p.human, "--agent": p.agent, "--meeting": p.meeting, "--xp": accent,
    // The focus heatmap follows the human colour; the logo follows the accent.
    "--heat-0": `color-mix(in srgb, ${bg.raised} 97%, #ffffff)`,
    "--heat-1": `color-mix(in srgb, ${p.human} 22%, ${bg.raised})`,
    "--heat-2": `color-mix(in srgb, ${p.human} 45%, ${bg.raised})`,
    "--heat-3": `color-mix(in srgb, ${p.human} 70%, ${bg.raised})`,
    "--heat-4": p.human,
    "--heat-5": `color-mix(in srgb, ${p.human} 75%, #ffffff)`,
    "--logo-1": `color-mix(in srgb, ${accent} 70%, #ffffff)`,
    "--logo-2": `color-mix(in srgb, ${accent} 80%, #000000)`,
  };
}

/** CSS for someone's choices; empty for the defaults (globals.css already has them). */
export function appearanceCss(a: Appearance): string {
  const same = (Object.keys(DEFAULT_APPEARANCE) as Array<keyof Appearance>).every((k) => a[k] === DEFAULT_APPEARANCE[k]);
  if (same) return "";
  const vars = appearanceVars(a);
  return `:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join("; ")}; }`;
}

/** The tab icon in the accent colour (the same mark as app/icon.svg). */
export function faviconSvg(accentId: string): string {
  const accent = ACCENTS.find((x) => x.id === accentId) ?? ACCENTS[0]!;
  const [light, dark] = accent.id === "ember" ? ["#FFB36B", "#D4521C"] : [mix(accent.colour, "#ffffff", 0.3), mix(accent.colour, "#000000", 0.2)];
  return `<svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="${LOGO_PATH}" fill="url(#g)"/><defs><linearGradient id="g" x1="56.16" y1="-4.16" x2="-7.54" y2="59.54" gradientUnits="userSpaceOnUse"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs></svg>`;
}

function mix(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export const LOGO_PATH = "M50.44 0C51.3016 0 52 0.698435 52 1.56V14.0762C52 15.0028 50.8798 15.4668 50.2246 14.8116L37.1884 1.77539C36.5332 1.12023 36.9972 0 37.9238 0H50.44ZM19.539 1.77539C18.8838 1.12023 19.3478 0 20.2744 0H27.0191C27.2949 0 27.5594 0.109572 27.7545 0.30461L51.6954 24.2455C51.8904 24.4406 52 24.7051 52 24.9809V31.7256C52 32.6522 50.8798 33.1162 50.2246 32.461L19.539 1.77539ZM10.1051 0.304609C9.91004 0.109571 9.64551 0 9.36968 0H1.56C0.698436 0 0 0.698434 0 1.56V15.6C0 16.1744 0.465623 16.64 1.04 16.64H3.12C8.28939 16.64 12.48 20.8306 12.48 26C12.48 31.1694 8.28939 35.36 3.12 35.36H1.04C0.465624 35.36 0 35.8256 0 36.4V50.44C0 51.3016 0.698434 52 1.56 52H15.6C16.1744 52 16.64 51.5344 16.64 50.96V48.88C16.64 43.7106 20.8306 39.52 26 39.52C31.1694 39.52 35.36 43.7106 35.36 48.88V50.96C35.36 51.5344 35.8256 52 36.4 52H50.44C51.3016 52 52 51.3016 52 50.44V42.6303C52 42.3545 51.8904 42.09 51.6954 41.8949L10.1051 0.304609Z";

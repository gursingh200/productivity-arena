"use client";

import { createContext, useContext, useId } from "react";
import type { BarStyle } from "@/lib/colours";

const BarStyleContext = createContext<BarStyle>("solid");

/** Makes someone's bar style (Settings → Appearance) available to every chart below it. */
export function BarStyleProvider({ value, children }: { value: BarStyle; children: React.ReactNode }) {
  return <BarStyleContext.Provider value={value}>{children}</BarStyleContext.Provider>;
}

export function useBarStyle(): BarStyle {
  return useContext(BarStyleContext);
}

/**
 * SVG bars in the chosen style. Render `defs` once inside the chart's <svg>,
 * then spread `paint(key, colour)` onto each bar.
 */
export function useBarPaint(series: Array<{ key: string; color: string }>) {
  const style = useBarStyle();
  const uid = useId().replace(/:/g, "");
  const id = (key: string) => `bar-${uid}-${key}`;
  const defs = style === "striped" || style === "dotted" ? (
    <defs>
      {series.map(({ key, color }) => (
        <pattern key={key} id={id(key)} width="6" height="6" patternUnits="userSpaceOnUse"
          patternTransform={style === "striped" ? "rotate(45)" : undefined}>
          <rect width="6" height="6" fill={color} />
          {style === "striped"
            ? <rect width="2.4" height="6" fill="#000" fillOpacity="0.38" />
            : <circle cx="3" cy="3" r="1.1" fill="#000" fillOpacity="0.45" />}
        </pattern>
      ))}
    </defs>
  ) : null;
  const paint = (key: string, color: string): React.SVGAttributes<SVGElement> => {
    switch (style) {
      case "striped":
      case "dotted": return { fill: `url(#${id(key)})` };
      case "soft": return { fill: color, fillOpacity: 0.42, stroke: color, strokeWidth: 1 };
      case "outline": return { fill: color, fillOpacity: 0.1, stroke: color, strokeWidth: 1.5 };
      default: return { fill: color };
    }
  };
  return { defs, paint };
}

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

type Report = (event: "konami" | "tap_tap") => void;
const ReportContext = createContext<Report>(() => {});

/** Easter eggs the browser notices, and the toast that says what they unlocked. */
export function EasterEggs({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const progress = useRef(0);

  const report = useCallback<Report>(async (event) => {
    try {
      const res = await fetch("/api/achievements/event", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event }),
      });
      const { unlocked } = (await res.json()) as { unlocked?: string[] };
      if (unlocked?.length) setToast(unlocked[0]!);
    } catch {
      // An easter egg failing silently is fine.
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const expected = KONAMI[progress.current]!;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      progress.current = key === expected ? progress.current + 1 : key === KONAMI[0] ? 1 : 0;
      if (progress.current === KONAMI.length) {
        progress.current = 0;
        void report("konami");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ReportContext.Provider value={report}>
      {children}
      {toast ? (
        <div className="toast" role="status">
          <span className="toast-label">Achievement unlocked</span>
          <b>{toast}</b>
        </div>
      ) : null}
    </ReportContext.Provider>
  );
}

/** Wraps your own league badge: ten clicks is a secret. */
export function TapBadge({ children }: { children: React.ReactNode }) {
  const report = useContext(ReportContext);
  const taps = useRef(0);
  return (
    <div className="tap-badge" onClick={() => { taps.current += 1; if (taps.current === 10) report("tap_tap"); }}>
      {children}
    </div>
  );
}

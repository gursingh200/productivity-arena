"use client";

import { useState } from "react";

/** A block of text with a button that copies it. */
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }
  return (
    <div className="copy-text">
      <pre>{text}</pre>
      <button className="btn btn-sm btn-quiet" onClick={copy}>{copied ? "Copied" : label}</button>
    </div>
  );
}

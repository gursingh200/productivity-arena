"use client";

import { useRouter } from "next/navigation";

/** Picking someone goes straight there, no button: `href(handle)` is where, `""` = nobody. */
export function PersonSelect({ people, value, param, path, placeholder, label }: {
  people: Array<{ handle: string; name: string }>;
  value: string;
  /** The query parameter that carries the handle, e.g. "with" or "vs". */
  param: string;
  path: string;
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  return (
    <select className="input person-select" aria-label={label} value={value}
      onChange={(e) => router.push(e.target.value ? `${path}?${param}=${encodeURIComponent(e.target.value)}` : path)}>
      <option value="">{placeholder}</option>
      {people.map((p) => <option key={p.handle} value={p.handle}>{p.name}</option>)}
    </select>
  );
}

/** Arena mark: a flame inside a ring. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--human)" strokeWidth="2" />
      <path d="M12 5.5c.4 2.3 2.9 3.6 2.9 6.6a2.9 2.9 0 0 1-5.8 0c0-1.3.6-2.1 1.3-2.8.2 1 .8 1.6 1.4 1.8-.4-2 .1-3.9.2-5.6Z" fill="var(--human)" />
    </svg>
  );
}

import { LOGO_PATH } from "@/lib/colours";

/** Arena mark: the Clueso mark in the accent colour (ember by default, like the favicon). */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 52 52" aria-hidden>
      <defs>
        <linearGradient id="arena-mark-ember" x1="56.16" y1="-4.16" x2="-7.54" y2="59.54" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "var(--logo-1, #FFB36B)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-2, #D4521C)" }} />
        </linearGradient>
      </defs>
      <path fillRule="evenodd" clipRule="evenodd" fill="url(#arena-mark-ember)" d={LOGO_PATH} />
    </svg>
  );
}

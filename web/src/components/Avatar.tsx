/** Round avatar: the user's photo, or initials on a color derived from their name. */
export function Avatar({ name, image, size = 36, className = "" }: { name: string | null; image?: string | null; size?: number; className?: string }) {
  const label = name ?? "?";
  const initials = label.split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `oklch(0.45 0.08 ${hue})` }}
      aria-hidden={image ? undefined : true}
    >
      {image ? <img src={image} alt={label} /> : initials}
    </span>
  );
}

import { downloadUrl } from "@/lib/download";

/** Downloads the newest Arena.dmg. Renders nothing if no releases repo is set. */
export function DownloadButton({ className = "btn" }: { className?: string }) {
  const url = downloadUrl();
  if (!url) return null;
  return <a className={className} href={url}>Download Arena for Mac</a>;
}

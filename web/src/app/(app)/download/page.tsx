import Link from "next/link";
import { CopyText } from "@/components/CopyText";
import { DownloadButton } from "@/components/DownloadButton";
import { downloadUrl, installPrompt, siteUrl } from "@/lib/download";

export default function DownloadPage() {
  const dmg = downloadUrl();
  return (
    <div style={{ margin: "0 auto", maxWidth: 680 }}>
      <h1 className="page-title">Get Arena for Mac</h1>
      <p className="page-sub">
        Arena lives in the menu bar. It tracks your active time, coding agent time and calls, and updates itself.
        Needs macOS 14 or later.
      </p>

      {dmg ? (
        <>
          <ol className="steps">
            <li>
              <div className="step-title">Download and install</div>
              <p className="help">Open Arena.dmg and drag Arena into Applications. This link is always the newest version.</p>
              <div className="pair"><DownloadButton /></div>
            </li>
            <li>
              <div className="step-title">Open it once</div>
              <p className="help">
                The first open is blocked because Arena isn’t notarized by Apple. Go to System Settings, then
                Privacy &amp; Security, and click Open Anyway. You only do this once; updates install on their own.
              </p>
            </li>
            <li>
              <div className="step-title">Link it to your account</div>
              <p className="help">When the flame icon shows in the menu bar, <Link href="/connect">connect your Mac</Link>.</p>
            </li>
          </ol>

          <h2 className="section-label">Or let your AI install it</h2>
          <p className="help" style={{ marginBottom: 12 }}>Paste this into Claude Code, Codex or another coding agent on your Mac.</p>
          <CopyText text={installPrompt(dmg, siteUrl())} label="Copy prompt" />
        </>
      ) : (
        <p className="notice">No download is set up for this site yet. Ask your admin for Arena.app.</p>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { SharingForm } from "@/components/SharingForm";
import { firstName } from "@/components/format";
import { shares } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

/** First sign-in: choose what to share before seeing anyone else's stats. */
export default async function WelcomePage() {
  const viewer = await requireViewer();
  if (viewer.onboardedAt) redirect("/");
  return (
    <div className="welcome">
      <div className="signin-brand"><BrandMark size={30} /><span>Arena</span></div>
      <h1 className="signin-title">Welcome, {firstName(viewer.name ?? "there")}.<span>Choose what you share.</span></h1>
      <p className="rule">
        <b>Give to get.</b> You’ll see a stat of a teammate only if you share that stat too. If you keep
        Human hours private, you won’t see anyone else’s, and you won’t appear on that leaderboard.
        Nobody sees more than this, admins included. You can change it any time in Settings.
      </p>
      <SharingForm initial={shares(viewer)} submitLabel="Continue" redirectTo="/" />
    </div>
  );
}

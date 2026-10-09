import { SharingForm } from "@/components/SharingForm";
import { shares } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

export default async function SharingSettingsPage() {
  const user = await requireViewer();
  return (
    <div className="panel">
      <p className="rule"><b>Give to get.</b> You see a stat of someone else only if you share that stat too. Nobody can see more, admins included.</p>
      <SharingForm initial={shares(user)} submitLabel="Save sharing" />
    </div>
  );
}

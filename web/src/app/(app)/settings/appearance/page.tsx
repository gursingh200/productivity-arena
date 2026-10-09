import { appearanceOf } from "@/lib/colours";
import { requireViewer } from "@/lib/viewer";
import AppearanceForm from "../AppearanceForm";

export default async function AppearanceSettingsPage() {
  const viewer = await requireViewer();
  return (
    <div className="panel">
      <p className="help" style={{ marginTop: 0 }}>Only you see your appearance. It applies here and on your Mac’s dashboard.</p>
      <AppearanceForm initial={appearanceOf(viewer)} />
    </div>
  );
}

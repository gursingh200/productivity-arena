import { requireViewer } from "@/lib/viewer";
import { SettingsTabs } from "./SettingsTabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  return (
    <div className="settings-page">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Signed in as {viewer.email}.</p>
      <SettingsTabs />
      {children}
    </div>
  );
}

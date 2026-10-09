import { requireViewer } from "@/lib/viewer";
import ProfileForm from "./ProfileForm";

export default async function ProfileSettingsPage() {
  const user = await requireViewer();
  return (
    <div className="panel">
      <ProfileForm initialName={user.name ?? ""} initialHandle={user.handle ?? ""} initialBio={user.bio ?? ""} initialTimezone={user.timezone} />
    </div>
  );
}

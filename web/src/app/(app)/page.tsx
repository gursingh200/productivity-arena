import { redirect } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";
import { loadProfile } from "@/lib/profile";
import { requireViewer } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await requireViewer();
  if (!viewer.handle) redirect("/settings");
  const data = await loadProfile(viewer.handle, viewer);
  if (!data) redirect("/settings");
  return <ProfileView data={data} />;
}

import { notFound } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";
import { loadProfile } from "@/lib/profile";
import { requireViewer } from "@/lib/viewer";

export default async function UserPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const viewer = await requireViewer();
  const data = await loadProfile(decodeURIComponent(handle), viewer);
  if (!data) notFound();
  return <ProfileView data={data} />;
}

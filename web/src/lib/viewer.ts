import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

/** The signed-in user, read fresh from the database (role and handle can change). */
export async function getViewer(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? null;
}

export async function requireViewer(): Promise<User> {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/signin");
  return viewer;
}

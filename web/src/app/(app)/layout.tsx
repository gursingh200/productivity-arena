import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/BrandMark";
import { NavLinks } from "@/components/NavLinks";
import { requireViewer } from "@/lib/viewer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  // Everyone picks their sharing on first sign-in before seeing anything else.
  if (!viewer.onboardedAt) redirect("/welcome");
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand"><BrandMark /><span>Arena</span></Link>
        <NavLinks />
        {/* Opens on hover, and on focus for keyboard and touch. */}
        <div className="account">
          <button type="button" className="account-trigger" aria-label="Account menu" aria-haspopup="menu">
            <Avatar name={viewer.name} image={viewer.image} size={34} />
          </button>
          <div className="account-menu">
            <Link href={`/u/${viewer.handle}`}>Your profile</Link>
            <Link href="/day">Your day</Link>
            <Link href="/connect">Connect a Mac</Link>
            <Link href="/settings">Settings</Link>
            {viewer.role === "admin" ? <Link href="/admin">Team overview</Link> : null}
            <hr />
            <form action={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

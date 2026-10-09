import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/BrandMark";
import { NavLinks } from "@/components/NavLinks";
import { EasterEggs } from "@/components/EasterEggs";
import { checkInsomniac } from "@/lib/achievements";
import { BarStyleProvider } from "@/components/BarStyle";
import { appearanceCss, appearanceOf } from "@/lib/colours";
import { getViewer } from "@/lib/viewer";
import type { Metadata } from "next";
import { requireViewer } from "@/lib/viewer";
import { isAdmin, isGuildAdmin } from "@/lib/roles";

/** The tab icon follows the accent colour. */
export async function generateMetadata(): Promise<Metadata> {
  const viewer = await getViewer();
  const accent = viewer ? appearanceOf(viewer).accent : "ember";
  return accent === "ember" ? {} : { icons: { icon: `/api/icon?accent=${accent}` } };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  // Everyone picks their sharing on first sign-in before seeing anything else.
  if (!viewer.onboardedAt) redirect("/welcome");
  await checkInsomniac(viewer.id, viewer.timezone);
  const appearance = appearanceOf(viewer);
  const css = appearanceCss(appearance);
  return (
    <>
      {/* Their appearance (Settings → Appearance); nothing for the defaults. */}
      {css ? <style>{css}</style> : null}
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
            <Link href="/compare">Compare</Link>
            <Link href="/connect">Connect a Mac</Link>
            <Link href="/settings">Settings</Link>
            <Link href="/changelog">What’s new</Link>
            {isGuildAdmin(viewer) ? <Link href="/guild">Your guild</Link> : null}
            {isAdmin(viewer) ? <Link href="/admin">Team overview</Link> : null}
            <hr />
            <form action={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page" data-bars={appearance.barStyle}>
        <BarStyleProvider value={appearance.barStyle}><EasterEggs>{children}</EasterEggs></BarStyleProvider>
      </main>
    </>
  );
}

import { ViewTransition } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

/** The sidebar's collapsed preference. A cookie rather than localStorage
 * because the server has to know it: localStorage is unreadable during a
 * server render, so the rail would paint full-width and snap narrow on every
 * page load. */
const SIDEBAR_COOKIE = "sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  // One round trip, not two: the sidebar's My Tasks count and quick-add's
  // member list are both needed on every screen and neither depends on the
  // other.
  const [members, myTaskCount] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Open work only, matching what /my-tasks shows by default — a count
    // that includes DONE would never go down and would stop meaning anything.
    prisma.task.count({
      where: { assignees: { some: { userId: session.user.id } }, status: { not: "DONE" } },
    }),
  ]);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // A Server Action, so the toggle is a plain form post: no client state, no
  // hydration guard, and it works with JavaScript off. Setting a cookie here
  // returns the re-rendered layout in the same roundtrip.
  async function toggleSidebarAction() {
    "use server";
    const store = await cookies();
    store.set(
      SIDEBAR_COOKIE,
      store.get(SIDEBAR_COOKIE)?.value === "collapsed" ? "expanded" : "collapsed",
      // A year: this is a display preference, not a session. sameSite lax is
      // enough — nothing here is a credential, and the worst a forged toggle
      // could do is make someone's sidebar narrow.
      { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" }
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        myTaskCount={myTaskCount}
        collapsed={collapsed}
        toggleAction={toggleSidebarAction}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={session.user.name ?? ""}
          userEmail={session.user.email ?? ""}
          signOutAction={signOutAction}
          members={members}
        />
        {/* `update`, not `enter`/`exit`. Those two fire when a ViewTransition
            mounts or unmounts; this one lives in the layout and stays mounted
            across every route, so a navigation only ever changes its children
            — which React treats as an update. The Next.js guide puts its
            wrapper inside a page, where enter/exit do apply, and copying that
            shape into a layout produces no animation at all.

            default:"none" keeps untyped navigations still: initial loads, and
            sidebar jumps, which are lateral rather than forward or back. Only
            links that opt in via transitionTypes move. */}
        <main className="flex-1 overflow-y-auto">
          <ViewTransition
            update={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
            default="none"
          >
            {children}
          </ViewTransition>
        </main>
      </div>
    </div>
  );
}

import { ViewTransition } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

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

  return (
    <div className="flex h-screen">
      <Sidebar myTaskCount={myTaskCount} />
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

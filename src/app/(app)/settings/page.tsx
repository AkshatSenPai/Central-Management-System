import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeControl } from "@/components/settings/theme-control";
import { clientInitials } from "@/lib/client";
import type { IconName } from "@/lib/icons";

/** A titled panel, matching the design's Settings sections. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-[13.5px] font-bold tracking-[-0.01em] text-[var(--text)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A destination row: what it is, what it does, and where it goes.
 *
 * What this replaces was two bare blue links with no explanation of either —
 * the last screen in the app that still looked like scaffolding. A row states
 * its purpose, so "Members" does not have to be clicked to find out whether
 * it is the thing you wanted. */
function LinkRow({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-forward"]}
      className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-2)]"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[var(--surface-3)] text-[var(--text-2)]"
      >
        <Icon name={icon} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[var(--text)]">{title}</span>
        <span className="block truncate text-[12.5px] text-[var(--text-3)]">{description}</span>
      </span>
      <Icon name="chevron_right" size="sm" className="text-[var(--text-3)]" />
    </Link>
  );
}

export default async function SettingsPage() {
  const session = await auth();
  // The layout already redirects; repeated because this page reads
  // session.user directly and TypeScript cannot see a guard in another file.
  if (!session?.user) redirect("/login");

  const name = session.user.name ?? "";
  const isAdmin = session.user.role === "ADMIN";

  return (
    <div className="mx-auto max-w-[720px] space-y-5 px-6 pb-10 pt-5">
      <PageHeader title="Settings" subtitle="Your account, and how the app looks." />

      <Section title="Account">
        <div className="flex items-center gap-3 p-4">
          <InitialsAvatar initials={clientInitials(name)} shape="circle" size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--text)]">{name}</p>
            <p className="truncate text-[12.5px] text-[var(--text-3)]">{session.user.email}</p>
          </div>
          {/* The role is here because it explains the page: it is the reason
              Members is or is not listed below. */}
          <Badge kind={isAdmin ? "strong" : "neutral"}>{isAdmin ? "Admin" : "Member"}</Badge>
        </div>
      </Section>

      <Section title="Appearance">
        <ThemeControl />
      </Section>

      <Section title="Manage">
        <LinkRow
          href="/settings/profile"
          icon="person"
          title="My profile"
          description="Your name, title, phone number and password"
        />
        {isAdmin ? (
          <LinkRow
            href="/settings/members"
            icon="groups"
            title="Members"
            description="Invite people, change roles, deactivate accounts"
          />
        ) : null}
      </Section>
    </div>
  );
}

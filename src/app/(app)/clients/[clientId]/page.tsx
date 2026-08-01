import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getClientDetail } from "@/lib/client-queries";
import { listClientActivity } from "@/lib/activity";
import { CLIENT_STATUS_BADGE, CLIENT_STATUS_LABEL } from "@/lib/client";
import { isProjectActive } from "@/lib/project";
import { monthYear } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { ClientForm } from "@/components/clients/client-form";
import { ClientDeleteButton } from "@/components/clients/client-delete-button";
import { ContactList } from "@/components/clients/contact-list";
import { ContactForm } from "@/components/clients/contact-form";
import { ProjectRow } from "@/components/projects/project-row";
import { ProjectForm } from "@/components/projects/project-form";

const CHIP = "text-xs text-[var(--text-3)]";

export default async function ClientDetailPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const [client, activity, session, members] = await Promise.all([
    getClientDetail(prisma, clientId),
    listClientActivity(prisma, { clientId }),
    auth(),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!client) notFound();

  const isAdmin = session?.user.role === "ADMIN";
  const websiteLabel = client.website?.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  return (
    <div className="space-y-6 p-8">
      <nav className="text-xs text-[var(--text-3)]">
        <Link href="/clients" className="hover:text-[var(--text-2)]">
          Clients
        </Link>
        <span> / </span>
        <span className="text-[var(--text-2)]">{client.name}</span>
      </nav>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <InitialsAvatar initials={client.initials} shape="square" size={44} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-[var(--text)]">{client.name}</h1>
              <Badge kind={CLIENT_STATUS_BADGE[client.status]} dot>
                {CLIENT_STATUS_LABEL[client.status]}
              </Badge>
              {client.engagementType ? (
                <Badge kind="neutral">{client.engagementType}</Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {client.sector ? <span className={CHIP}>{client.sector}</span> : null}
              {client.website && websiteLabel ? (
                <a
                  href={client.website}
                  target="_blank"
                  rel="noreferrer"
                  className={`${CHIP} hover:text-[var(--accent)]`}
                >
                  {websiteLabel}
                </a>
              ) : null}
              {client.accountLead ? (
                <span className={CHIP}>Account lead {client.accountLead.name}</span>
              ) : null}
              {client.clientSince ? (
                <span className={CHIP}>Client since {monthYear(client.clientSince)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-none items-start gap-2">
          <ClientForm
            client={{
              id: client.id,
              name: client.name,
              status: client.status,
              sector: client.sector,
              website: client.website,
              engagementType: client.engagementType,
              clientSince: client.clientSince,
              accountLeadId: client.accountLead?.id ?? null,
              notes: client.notes,
            }}
            members={members}
          />
          {isAdmin ? <ClientDeleteButton clientId={client.id} /> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-medium text-[var(--text)]">Projects</h2>
                <span className="text-xs text-[var(--text-3)]">
                  {client.projects.filter((p) => isProjectActive(p.status)).length} active
                </span>
              </div>
              <ProjectForm presetClientId={client.id} />
            </div>
            {client.projects.length === 0 ? (
              <EmptyState message="No projects for this client yet." />
            ) : (
              <div className={cardClass({ className: "overflow-hidden" })}>
                {client.projects.map((row) => (
                  <ProjectRow key={row.id} row={row} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-[var(--text)]">Activity</h2>
            <ActivityTimeline entries={activity} />
          </section>
        </div>

        <aside className={cardClass({ className: "h-fit space-y-4 p-4" })}>
          <h2 className="text-sm font-semibold text-[var(--text)]">Contacts</h2>
          {client.contacts.length === 0 ? (
            <EmptyState message="No contacts yet." />
          ) : (
            <ContactList clientId={client.id} contacts={client.contacts} />
          )}
          <ContactForm clientId={client.id} />
        </aside>
      </div>
    </div>
  );
}

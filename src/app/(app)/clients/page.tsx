import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listClients } from "@/lib/client-queries";
import { clientListSummary, CLIENT_STATUS_BADGE, CLIENT_STATUS_LABEL } from "@/lib/client";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { ClientForm } from "@/components/clients/client-form";

const COLUMNS = "grid-cols-[2fr_1fr_0.7fr_1.5fr]";

export default async function ClientsPage() {
  const [rows, members] = await Promise.all([
    listClients(prisma),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6 p-8">
      <PageHeader
        title="Clients"
        subtitle={clientListSummary(rows)}
        action={<ClientForm members={members} />}
      />

      {rows.length === 0 ? (
        <EmptyState message="No clients yet." actionLabel="Add your first client." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div
            className={`grid ${COLUMNS} gap-4 border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold tracking-wide text-[var(--text-3)]`}
          >
            <span>Client</span>
            <span>Status</span>
            <span>Projects</span>
            <span>Primary contact</span>
          </div>

          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/clients/${row.id}`}
              className={`grid ${COLUMNS} items-center gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-2)]`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <InitialsAvatar initials={row.initials} shape="square" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text)]">{row.name}</p>
                  {row.sector ? (
                    <p className="truncate text-xs text-[var(--text-3)]">{row.sector}</p>
                  ) : null}
                </div>
              </div>

              <Badge kind={CLIENT_STATUS_BADGE[row.status]} dot>
                {CLIENT_STATUS_LABEL[row.status]}
              </Badge>

              <span className="text-sm text-[var(--text-2)]">{row.projectCount}</span>

              {row.primaryContact ? (
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--text-2)]">{row.primaryContact.name}</p>
                  {row.primaryContact.email ? (
                    <p className="truncate text-xs text-[var(--text-3)]">
                      {row.primaryContact.email}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-[var(--text-3)]">—</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

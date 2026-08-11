import { prisma } from "@/lib/prisma";
import { listContracts } from "@/lib/contract-queries";
import { CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, type ContractStatus } from "@/lib/contract";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractRow } from "@/components/contracts/contract-row";
import { ContractStatusFilter } from "@/components/contracts/contract-status-filter";

/** The agreement register.
 *
 * Spec §07, "one thing worth building early": "An agreement-number register.
 * Numbers are referenced across paired documents and are the only way to tie
 * a signed PDF back to a deal."
 *
 * So this page's job is to answer "what is SO/OT/2026/055" from the number
 * alone, without knowing whose it was — which is why it lists every contract
 * across every client, newest first, with the number in the leading column.
 */
export default async function ContractsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await props.searchParams;
  const active = CONTRACT_STATUSES.includes(status as ContractStatus)
    ? (status as ContractStatus)
    : undefined;

  const rows = await listContracts(prisma, { status: active });
  const issued = rows.filter((r) => r.status === "ISSUED").length;

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHeader
        title="Contracts"
        subtitle={`${rows.length} ${rows.length === 1 ? "document" : "documents"} · ${issued} issued`}
        action={<ContractStatusFilter active={active ?? null} />}
      />

      <SectionCard title="Register" flush={rows.length > 0}>
        {rows.length === 0 ? (
          <EmptyState
            message={
              active
                ? `No ${CONTRACT_STATUS_LABEL[active].toLowerCase()} contracts.`
                : "No contracts yet. Start one from a client's page — the client is what a contract is for, so that is where it begins."
            }
          />
        ) : (
          rows.map((row) => <ContractRow key={row.id} row={row} clientName={row.clientName} />)
        )}
      </SectionCard>
    </div>
  );
}

import Link from "next/link";
import {
  CONTRACT_KIND_LABEL,
  CONTRACT_STATUS_BADGE,
  CONTRACT_STATUS_LABEL,
  dealSummary,
} from "@/lib/contract";
import type { ContractListRow } from "@/lib/contract-queries";
import { shortDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

/** One contract in a list, on the client page and in the register.
 *
 * The agreement number leads when there is one — it is the handle everything
 * else refers to, and "SO/OT/2026/055" is what somebody has in front of them
 * when they come looking. A draft has no number and says so rather than
 * showing a placeholder that could be mistaken for one. */
export function ContractRow({
  row,
  clientName,
}: {
  row: ContractListRow;
  clientName?: string;
}) {
  return (
    <Link
      href={`/contracts/${row.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-2)]"
    >
      <span className="font-mono text-xs text-[var(--text-2)]">
        {row.agreementNo ?? "— not issued —"}
      </span>
      <Badge kind={CONTRACT_STATUS_BADGE[row.status]} dot>
        {CONTRACT_STATUS_LABEL[row.status]}
      </Badge>
      <span className="text-sm text-[var(--text)]">{CONTRACT_KIND_LABEL[row.deal.kind]}</span>
      <span className="text-xs text-[var(--text-3)]">{dealSummary(row.deal)}</span>
      <span className="flex-1" />
      {clientName ? <span className="text-xs text-[var(--text-2)]">{clientName}</span> : null}
      <span className="text-xs text-[var(--text-3)]">{row.projectName}</span>
      <span className="text-xs text-[var(--text-3)]">
        {shortDate(row.issuedAt ?? row.createdAt)}
      </span>
    </Link>
  );
}
